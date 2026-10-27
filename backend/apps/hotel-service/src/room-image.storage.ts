import { status as GrpcStatus } from '@grpc/grpc-js';
import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { rpcError } from '@app/common';

// 객실 사진으로 받는 파일 형식 → 저장소 파일 확장자
const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// 객실 사진 경로: room-types/{roomTypeId}/{uuid}.{ext} (ERD #161). 객실 수정 때 다른 객실의 파일을 가리키지 못하게
// 이 경로가 그 객실 것인지 확인하는 데도 쓴다.
function objectKeyPrefix(roomId: number): string {
  return `room-types/${roomId}/`;
}

// Presigned URL 유효 시간. 올리기는 사진 선택 직후 바로 쓰므로 짧게, 보기는 화면을 켜 둔 동안 깨지지 않게 넉넉하게.
const UPLOAD_URL_EXPIRES_SECONDS = 5 * 60;
const VIEW_URL_EXPIRES_SECONDS = 60 * 60;

// proto의 RoomImageUploadUrl 메시지와 1:1 대응되는 응답 형태
export interface RoomImageUploadUrl {
  uploadUrl: string;
  objectKey: string;
  expiresIn: number;
}

// 객실 사진 저장소(S3 호환: 로컬·온프레미스 dev는 MinIO, 운영은 AWS S3).
// 버킷이 비공개라 브라우저는 저장소에 직접 접근하지 못하고, 여기서 서명한 Presigned URL로만 사진을 올리고 본다.
// 운영은 보기만 CloudFront 고정 URL(IMAGE_BASE_URL)로 내려준다 — CloudFront(OAC)만 버킷을 읽을 수 있다.
// DB(room_images.object_key)에는 경로만 저장하고 주소는 환경변수로 정하므로, MinIO ↔ S3 전환에 코드 변경이 없다.
//
// Presigned URL은 서명에 주소(Host)가 들어가서, 브라우저가 실제로 여는 주소로 서명해야 한다.
// 로컬 docker compose에서는 hotel-service가 minio:9000으로 접근하지만 브라우저는 localhost:9000을 열기 때문에
// 서명용 주소(S3_PUBLIC_ENDPOINT)를 따로 둔다. 온프레미스 dev(DB 노드 Tailscale IP)와 운영(S3)은 둘이 같아서 비워 둔다.
@Injectable()
export class RoomImageStorage {
  private readonly logger = new Logger(RoomImageStorage.name);
  private readonly bucket = process.env.S3_BUCKET || 'room-images';
  // 저장소에 직접 요청(파일 확인·삭제)할 때 쓰는 클라이언트
  private readonly client: S3Client;
  // Presigned URL 서명 전용 클라이언트 (브라우저가 여는 주소로 서명)
  private readonly signer: S3Client;
  // 사진 보기 고정 주소 (운영: CloudFront https://<도메인>, /room-types/* 가 버킷으로 연결됨).
  // 있으면 서명 없이 <IMAGE_BASE_URL>/<objectKey> 를 내려준다 — objectKey 가 올릴 때마다 새 uuid 라 주소가 바뀌지 않아 캐시된다.
  // 없으면(로컬 · 온프레미스) 기존처럼 Presigned GET URL 을 만든다.
  private readonly imageBaseUrl = (process.env.IMAGE_BASE_URL || '').replace(
    /\/+$/,
    '',
  );

  constructor() {
    const endpoint = process.env.S3_ENDPOINT || undefined;
    const publicEndpoint = process.env.S3_PUBLIC_ENDPOINT || endpoint;
    const region = process.env.S3_REGION || 'ap-northeast-2';
    const forcePathStyle = process.env.S3_FORCE_PATH_STYLE === 'true';
    // 키가 없으면(운영) SDK 기본 자격 증명 체인 → IAM 역할(IRSA)로 인증한다.
    const credentials =
      process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
        ? {
            accessKeyId: process.env.S3_ACCESS_KEY_ID,
            secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
          }
        : undefined;

    this.client = new S3Client({
      endpoint,
      region,
      forcePathStyle,
      credentials,
    });
    this.signer = new S3Client({
      endpoint: publicEndpoint,
      region,
      forcePathStyle,
      credentials,
    });
  }

  // 관리자 사진 업로드용 Presigned URL. 브라우저가 이 주소로 파일을 PUT하고, 받은 objectKey를 객실 수정에 넣는다.
  // 파일 형식과 크기를 서명에 넣어서(content-type·content-length), 다른 형식이나 크기로는 올릴 수 없다.
  async createUploadUrl(
    roomId: number,
    mimeType: string,
    size: number,
  ): Promise<RoomImageUploadUrl> {
    const extension = ALLOWED_IMAGE_TYPES[mimeType];
    if (!extension) {
      throw rpcError(
        GrpcStatus.INVALID_ARGUMENT,
        'JPG·PNG·WEBP 이미지만 올릴 수 있습니다.',
      );
    }
    if (!Number.isInteger(size) || size <= 0 || size > MAX_IMAGE_BYTES) {
      throw rpcError(
        GrpcStatus.INVALID_ARGUMENT,
        '이미지는 5MB 이하만 올릴 수 있습니다.',
      );
    }

    const objectKey = `${objectKeyPrefix(roomId)}${randomUUID()}.${extension}`;
    const uploadUrl = await getSignedUrl(
      this.signer,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        ContentType: mimeType,
        ContentLength: size,
      }),
      {
        expiresIn: UPLOAD_URL_EXPIRES_SECONDS,
        signableHeaders: new Set(['content-type', 'content-length']),
      },
    );
    return { uploadUrl, objectKey, expiresIn: UPLOAD_URL_EXPIRES_SECONDS };
  }

  // 화면에 내려줄 사진 보기 URL (IMAGE_BASE_URL 이 있으면 고정 URL, 없으면 Presigned GET URL)
  async createViewUrl(objectKey: string): Promise<string> {
    if (this.imageBaseUrl) {
      return `${this.imageBaseUrl}/${objectKey}`;
    }
    return getSignedUrl(
      this.signer,
      new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }),
      { expiresIn: VIEW_URL_EXPIRES_SECONDS },
    );
  }

  // 객실 수정 때 받은 objectKey가 그 객실 경로에 실제로 올라간 사진인지 확인하고, 저장소에 기록된 파일 형식을 돌려준다.
  // 업로드 URL만 받고 올리지 않았거나, 다른 객실·다른 경로의 파일을 가리키면 수정을 막는다.
  async getUploadedImageType(
    roomId: number,
    objectKey: string,
  ): Promise<string> {
    if (!objectKey.startsWith(objectKeyPrefix(roomId))) {
      throw rpcError(
        GrpcStatus.INVALID_ARGUMENT,
        '이 객실의 사진 경로가 아닙니다.',
      );
    }
    try {
      const head = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: objectKey }),
      );
      const mimeType = head.ContentType ?? '';
      if (!ALLOWED_IMAGE_TYPES[mimeType]) {
        throw rpcError(
          GrpcStatus.INVALID_ARGUMENT,
          'JPG·PNG·WEBP 이미지만 등록할 수 있습니다.',
        );
      }
      return mimeType;
    } catch (err) {
      if (err instanceof RpcException) throw err;
      throw rpcError(
        GrpcStatus.INVALID_ARGUMENT,
        '업로드되지 않은 이미지입니다. 사진을 다시 올려 주세요.',
      );
    }
  }

  // 객실 사진 교체·객실 삭제 후 더 이상 쓰지 않는 파일을 지운다.
  // DB는 이미 반영된 뒤라, 저장소 삭제가 실패해도 요청은 성공으로 두고 로그만 남긴다(남은 파일은 화면에 안 보임).
  async deleteObjects(objectKeys: string[]): Promise<void> {
    if (objectKeys.length === 0) return;
    try {
      await this.client.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: { Objects: objectKeys.map((Key) => ({ Key })) },
        }),
      );
    } catch (err) {
      this.logger.warn(
        `객실 사진 파일 삭제 실패 (${objectKeys.length}개): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
