#!/bin/bash
# systemd_networkd_setup_improved.sh

echo "=== NetworkManager → systemd-networkd 전환 ==="

# 현재 게이트웨이 확인
current_gw=$(ip route | awk '/default/ {print $3}' | head -1)
echo "현재 게이트웨이: $current_gw"

# 네트워크 설정 디렉토리 확인
if [ -d "/etc/systemd/network" ]; then
    echo "✅ 네트워크 설정 디렉토리 이미 존재"
    echo "기존 설정 파일들:"
    ls -la /etc/systemd/network/ || echo "  (빈 디렉토리)"
else
    echo "📁 네트워크 설정 디렉토리 생성"
    sudo mkdir -p /etc/systemd/network
fi

# 기존 서비스 비활성화
echo "기존 네트워크 서비스 비활성화..."
sudo systemctl disable systemd-networkd-wait-online.service
sudo systemctl disable NetworkManager.service
sudo systemctl disable NetworkManager-wait-online.service
sudo systemctl disable wpa_supplicant.service

# systemd-networkd 활성화
echo "systemd-networkd 활성화..."
sudo systemctl enable systemd-networkd.service
sudo systemctl enable systemd-resolved.service

# 고정 IP 설정 파일 생성
echo "네트워크 설정 파일 생성: 10-eth0.network"
sudo tee /etc/systemd/network/10-eth0.network > /dev/null <<EOF
[Match]
Name=eth0

[Network]
Address=192.168.0.10/24
Gateway=${current_gw:-192.168.0.1}
DNS=1.1.1.1
DNS=8.8.8.8
DHCP=no
LinkLocalAddressing=no
IPv6AcceptRA=no
EOF

# resolv.conf 고정
echo "DNS 설정 고정..."
sudo rm -f /etc/resolv.conf
sudo tee /etc/resolv.conf > /dev/null <<EOF
nameserver 1.1.1.1
nameserver 8.8.8.8
EOF

echo "=== 설정 완료 ==="
