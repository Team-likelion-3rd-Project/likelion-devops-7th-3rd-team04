# Main VPC SG 와 규칙 (설계 문서 4-1절 M1 – M15)
#
# 노드(워커 · CP) 는 아웃바운드 전체 허용(M14) 이라 노드에서 출발하는 흐름은 대상 SG 인바운드만 만든다.
# 아웃바운드가 제한된 LB(ALB, 내부 NLB) 에서 출발하는 흐름은 인바운드 · 아웃바운드 양쪽을 만든다.
# 파드 → DB · Valkey 는 Calico natOutgoing 으로 출처가 워커 노드 IP 다 (M11, M12).
#
# M13 워커 → 결제 PrivateLink 엔드포인트 ENI(71-payment-link) → 결제 VPC. 엔드포인트 ENI 는 아웃바운드가 없다.

locals {
  main_security_groups = merge(
    {
      main_alb    = { vpc = "main", description = "Main public ALB" }
      main_worker = { vpc = "main", description = "Main kubernetes worker nodes" }
      main_db     = { vpc = "main", description = "Main RDS MariaDB" }
      main_valkey = { vpc = "main", description = "Main ElastiCache Valkey" }

      main_privatelink = { vpc = "main", description = "Main payment PrivateLink interface endpoint" }
    },
    var.enable_control_plane ? {
      main_cp           = { vpc = "main", description = "Main kubeadm control plane nodes" }
      main_internal_nlb = { vpc = "main", description = "Main kube-apiserver internal NLB" }
    } : {},
  )

  main_ingress_rules = merge(
    {
      # M1 사용자 → API (도메인 없으면 80 만 사용)
      m1_alb_http  = { sg = "main_alb", cidr = "0.0.0.0/0", port = 80, description = "M1 HTTP from internet" }
      m1_alb_https = { sg = "main_alb", cidr = "0.0.0.0/0", port = 443, description = "M1 HTTPS from internet" }

      # M2 api-gateway NodePort, Target Group 헬스체크
      m2_worker_nodeport = { sg = "main_worker", source = "main_alb", port = 30080, description = "M2 api-gateway NodePort from ALB" }

      # M8 metrics-server · Prometheus → kubelet
      m8_worker_kubelet_from_worker = { sg = "main_worker", source = "main_worker", port = 10250, description = "M8 kubelet from workers" }

      # M9 · M10 Calico VXLAN, Typha (워커 ↔ 워커)
      m9_worker_vxlan_from_worker  = { sg = "main_worker", source = "main_worker", protocol = "udp", port = 4789, description = "M9 Calico VXLAN from workers" }
      m10_worker_typha_from_worker = { sg = "main_worker", source = "main_worker", port = 5473, description = "M10 Calico Typha from workers" }

      # M11 · M12 파드 → Main DB, Valkey
      m11_db_from_worker     = { sg = "main_db", source = "main_worker", port = 3306, description = "M11 MariaDB from workers" }
      m12_valkey_from_worker = { sg = "main_valkey", source = "main_worker", port = 6379, description = "M12 Valkey from workers" }

      # M13 파드(api-gateway · booking-service) → 결제 gRPC. 파드 출처는 Calico natOutgoing 으로 워커 노드 IP
      m13_privatelink_from_worker = { sg = "main_privatelink", source = "main_worker", port = var.payment_grpc_port, description = "M13 payment gRPC from workers" }
    },
    var.enable_control_plane ? {
      # M3 · M4 kubelet · 파드 · CP 컴포넌트 → 내부 NLB → kube-apiserver
      m3_nlb_apiserver_from_worker = { sg = "main_internal_nlb", source = "main_worker", port = 6443, description = "M3 kube-apiserver from workers" }
      m4_nlb_apiserver_from_cp     = { sg = "main_internal_nlb", source = "main_cp", port = 6443, description = "M4 kube-apiserver from control plane" }

      # M5 NLB → kube-apiserver, 헬스체크. Target Group preserve_client_ip = false 라 출처가 NLB
      m5_cp_apiserver_from_nlb = { sg = "main_cp", source = "main_internal_nlb", port = 6443, description = "M5 kube-apiserver from internal NLB" }

      # M15 파드 → kubernetes Service(10.96.0.1:443) → kube-apiserver. kube-proxy 가 NLB 가 아닌 CP IP:6443 으로 DNAT 한다
      m15_cp_apiserver_from_worker = { sg = "main_cp", source = "main_worker", port = 6443, description = "M15 kube-apiserver via kubernetes Service from workers" }
      m15_cp_apiserver_from_cp     = { sg = "main_cp", source = "main_cp", port = 6443, description = "M15 kube-apiserver via kubernetes Service from control plane" }

      # M6 스택형 etcd 클라이언트 · 피어
      m6_cp_etcd_from_cp = { sg = "main_cp", source = "main_cp", from_port = 2379, to_port = 2380, description = "M6 etcd from control plane" }

      # M7 kube-apiserver → kubelet (logs, exec, port-forward)
      m7_worker_kubelet_from_cp = { sg = "main_worker", source = "main_cp", port = 10250, description = "M7 kubelet from control plane" }
      # CP 파드 대상. 요청이 NLB 를 거쳐 다른 CP 의 apiserver 로 가면 CP → CP 로 붙는다
      m7_cp_kubelet_from_cp = { sg = "main_cp", source = "main_cp", port = 10250, description = "M7 kubelet from control plane" }

      # M9 · M10 Calico VXLAN, Typha (워커 ↔ CP, CP ↔ CP)
      m9_worker_vxlan_from_cp  = { sg = "main_worker", source = "main_cp", protocol = "udp", port = 4789, description = "M9 Calico VXLAN from control plane" }
      m9_cp_vxlan_from_worker  = { sg = "main_cp", source = "main_worker", protocol = "udp", port = 4789, description = "M9 Calico VXLAN from workers" }
      m9_cp_vxlan_from_cp      = { sg = "main_cp", source = "main_cp", protocol = "udp", port = 4789, description = "M9 Calico VXLAN from control plane" }
      m10_worker_typha_from_cp = { sg = "main_worker", source = "main_cp", port = 5473, description = "M10 Calico Typha from control plane" }
      m10_cp_typha_from_worker = { sg = "main_cp", source = "main_worker", port = 5473, description = "M10 Calico Typha from workers" }
      m10_cp_typha_from_cp     = { sg = "main_cp", source = "main_cp", port = 5473, description = "M10 Calico Typha from control plane" }
    } : {},
  )

  main_egress_rules = merge(
    {
      # M2 ALB 는 대상 포트만
      m2_alb_to_worker_nodeport = { sg = "main_alb", source = "main_worker", port = 30080, description = "M2 api-gateway NodePort to workers" }

      # M14 NAT 경유 외부 · AWS API, 위 인바운드 규칙의 출발 쪽
      m14_worker_all = { sg = "main_worker", cidr = "0.0.0.0/0", protocol = "-1", description = "M14 all outbound" }
    },
    var.enable_control_plane ? {
      # M5 NLB 는 대상 포트만
      m5_nlb_to_cp_apiserver = { sg = "main_internal_nlb", source = "main_cp", port = 6443, description = "M5 kube-apiserver to control plane" }

      m14_cp_all = { sg = "main_cp", cidr = "0.0.0.0/0", protocol = "-1", description = "M14 all outbound" }
    } : {},
  )
}
