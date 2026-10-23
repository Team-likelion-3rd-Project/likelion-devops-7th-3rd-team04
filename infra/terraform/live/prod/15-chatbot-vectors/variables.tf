variable "project" {
  description = "리소스 이름/태그에 사용할 프로젝트 이름"
  type        = string
  default     = "team04-hotel"
}

variable "environment" {
  description = "환경 이름"
  type        = string
  default     = "prod"
}

variable "region" {
  description = "리전"
  type        = string
  default     = "us-east-1"
}

variable "vector_bucket_name" {
  description = "RAG 벡터 버킷 이름. gitops backend values 의 llm-service VECTOR_BUCKET_NAME 과 같아야 한다 (70 은 output 으로 받는다)"
  type        = string
  default     = "team04-hotel-chatbot-vectors"
}

variable "vector_index_name" {
  description = "RAG 벡터 인덱스 이름. gitops backend values 의 llm-service VECTOR_INDEX_NAME 과 같아야 한다"
  type        = string
  default     = "hotel-docs"
}

variable "vector_dimension" {
  description = "임베딩 차원. llm-service VERTEX_EMBED_MODEL(text-multilingual-embedding-002) 출력과 같아야 한다 — 모델을 바꾸면 인덱스를 새로 만든다"
  type        = number
  default     = 768
}
