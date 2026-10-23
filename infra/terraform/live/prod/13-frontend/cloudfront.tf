# CloudFront 배포 하나에 origin 2개 (사이트 · 객실 사진), 둘 다 OAC 로 서명 요청.

resource "aws_cloudfront_origin_access_control" "this" {
  for_each = aws_s3_bucket.this

  name                              = "${local.name}-${each.key}"
  description                       = "${each.key} bucket (${each.value.id})"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# 현재 사이트 버전. 쓰는 주체는 gitops main GitHub Actions(release.tf) 하나다.
# 값은 gitops merge 후 바뀌므로 Terraform 은 처음 만들 때만 넣고(none → Function 이 503) 이후 변경은 무시한다.
# ARN 끝의 ID 는 생성 시 무작위라, 다시 만들면 gitops Secret FRONTEND_KVS_ARN 을 바꿔야 하고 version 도 none 으로 돌아간다
resource "aws_cloudfront_key_value_store" "main" {
  name    = local.name
  comment = "frontend release version (gitops envs/prod/frontend)"

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_cloudfrontkeyvaluestore_key" "version" {
  key_value_store_arn = aws_cloudfront_key_value_store.main.arn
  key                 = "version"
  value               = "none"

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_cloudfront_function" "viewer_request" {
  name    = "${local.name}-viewer-request"
  runtime = "cloudfront-js-2.0"
  comment = "www redirect, release version path, SPA fallback"
  publish = true

  key_value_store_associations = [aws_cloudfront_key_value_store.main.arn]

  code = templatefile("${path.module}/templates/viewer-request.js.tftpl", {
    domain         = var.domain_name
    www_domain     = local.www_domain
    release_prefix = local.release_prefix
  })
}

data "aws_cloudfront_cache_policy" "caching_optimized" {
  name = "Managed-CachingOptimized"
}

data "aws_cloudfront_response_headers_policy" "security_headers" {
  name = "Managed-SecurityHeadersPolicy"
}

# 객실 사진: objectKey 가 올릴 때마다 새 uuid 라 같은 주소의 내용이 바뀌지 않는다 → 오래 캐시.
# Presigned PUT 으로 올린 객체에는 Cache-Control 이 없으므로 기본 TTL 을 길게 둔다
resource "aws_cloudfront_cache_policy" "image" {
  name        = "${local.name}-image"
  comment     = "room images: immutable object keys"
  min_ttl     = 86400
  default_ttl = 31536000
  max_ttl     = 31536000

  parameters_in_cache_key_and_forwarded_to_origin {
    enable_accept_encoding_brotli = false
    enable_accept_encoding_gzip   = false

    cookies_config {
      cookie_behavior = "none"
    }
    headers_config {
      header_behavior = "none"
    }
    query_strings_config {
      query_string_behavior = "none"
    }
  }
}

# 사진은 브라우저도 오래 캐시하게 Cache-Control 을 붙인다 (보안 헤더는 Managed-SecurityHeadersPolicy 와 같은 값)
resource "aws_cloudfront_response_headers_policy" "image" {
  name    = "${local.name}-image"
  comment = "security headers + immutable cache-control"

  custom_headers_config {
    items {
      header   = "Cache-Control"
      value    = "public, max-age=31536000, immutable"
      override = false
    }
  }

  security_headers_config {
    content_type_options {
      override = true
    }
    frame_options {
      frame_option = "SAMEORIGIN"
      override     = true
    }
    referrer_policy {
      referrer_policy = "strict-origin-when-cross-origin"
      override        = true
    }
    strict_transport_security {
      access_control_max_age_sec = 31536000
      override                   = true
    }
    xss_protection {
      protection = true
      mode_block = true
      override   = true
    }
  }
}

resource "aws_cloudfront_distribution" "main" {
  enabled         = true
  comment         = "${local.name} (${var.domain_name})"
  aliases         = [var.domain_name, local.www_domain]
  price_class     = var.price_class
  http_version    = "http2and3"
  is_ipv6_enabled = true

  origin {
    origin_id                = "site"
    domain_name              = aws_s3_bucket.this["site"].bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.this["site"].id
  }

  origin {
    origin_id                = "image"
    domain_name              = aws_s3_bucket.this["image"].bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.this["image"].id
  }

  # 사이트: index.html 은 업로드 때 no-cache, 해시가 붙은 assets 는 immutable (release:frontend).
  # 어느 쪽이든 경로에 버전이 들어가 버전 전환 시 무효화가 필요 없다
  default_cache_behavior {
    target_origin_id           = "site"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = data.aws_cloudfront_cache_policy.caching_optimized.id
    response_headers_policy_id = data.aws_cloudfront_response_headers_policy.security_headers.id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.viewer_request.arn
    }
  }

  # 객실 사진: 경로 그대로 사진 버킷으로 (room-types/<객실 id>/<uuid>.<확장자>). www 로 와도 그대로 응답한다
  ordered_cache_behavior {
    path_pattern               = "/${local.image_prefix}/*"
    target_origin_id           = "image"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = false
    cache_policy_id            = aws_cloudfront_cache_policy.image.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.image.id
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = data.aws_acm_certificate.main.arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  lifecycle {
    prevent_destroy = true
  }
}
