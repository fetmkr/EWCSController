#!/bin/bash
# EWCSBoot_optimization.sh

echo "=== 완전 부팅 최적화 ==="

# 1. 네트워크 관련 (이미 비활성화됨 - 확인차)
echo "네트워크 서비스 최종 확인..."

# 2. 블루투스/무선 관련
echo "무선 관련 서비스 비활성화..."
sudo systemctl disable bluetooth.service
sudo systemctl disable hciuart.service

# 3. 타이머 최적화 (전력 절약)
echo "타이머 최적화..."
sudo systemctl disable apt-daily.timer                      # 패키지 DB 업데이트
sudo systemctl disable apt-daily-upgrade.timer              # 자동 업그레이드
sudo systemctl disable man-db.timer                         # man DB 업데이트

# 4. 기타 불필요한 서비스
echo "불필요한 서비스.. "
sudo systemctl disable ModemManager.service #3G/4G/LTE Modem service
sudo systemctl disable polkit.service #GUI related service

echo "=== 최적화 완료 ==="
echo "재부팅 필요: sudo reboot"
