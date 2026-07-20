#!/bin/bash
# ============================================================
#  EC2 Startup Script
#  Run this after a reboot to bring all services back up.
#  Usage:  bash ~/startup.sh
# ============================================================

LOG_DATE=$(date +'%d.%m.%Y')
DIVIDER="------------------------------------------------------------"

echo ""
echo "============================================================"
echo "  EC2 Startup — $(date)"
echo "============================================================"


# ------------------------------------------------------------
# 1. Mount copyParty volume
# ------------------------------------------------------------
echo ""
echo "$DIVIDER"
echo "  [1/5] Mounting copyParty volume (/dev/xvdbb)"
echo "$DIVIDER"

# Only mount if not already mounted
if mountpoint -q /home/ubuntu/copyParty; then
    echo "  Already mounted — skipping."
else
    sudo mount /dev/xvdbb /home/ubuntu/copyParty
    if [ $? -eq 0 ]; then
        echo "  Mounted successfully."
    else
        echo "  ERROR: Mount failed! copyParty may not work correctly."
    fi
fi

# Re-enable the Gaussian Viewer swap file after the mounted volume is available.
GAUSSIAN_SWAP_FILE=/home/ubuntu/copyParty/gaussian-viewer/.swapfile
if swapon --noheadings --show=NAME | grep -Fxq "$GAUSSIAN_SWAP_FILE"; then
    echo "  Gaussian Viewer swap is already active."
elif [ -f "$GAUSSIAN_SWAP_FILE" ]; then
    sudo swapon "$GAUSSIAN_SWAP_FILE"
    echo "  Gaussian Viewer swap enabled."
else
    echo "  WARNING: Gaussian Viewer swap file is missing."
fi


# ------------------------------------------------------------
# 2. adimari-project Backend
# ------------------------------------------------------------
echo ""
echo "$DIVIDER"
echo "  [2/5] Starting adimari-project Backend"
echo "$DIVIDER"

if ss -tlnp | grep -q ':5001 '; then
    echo "  SKIPPED — port 5001 is already in use (service may already be running)."
    ADIMARI_PID="SKIPPED"
else
    cd /home/ubuntu/adimari-project/Backend
    nohup npm start > "log_adimari_${LOG_DATE}.log" 2>&1 &
    ADIMARI_PID=$!
    echo "  Started with PID: $ADIMARI_PID"
fi


# ------------------------------------------------------------
# 3. meshArchWeb BackEnd
# ------------------------------------------------------------
echo ""
echo "$DIVIDER"
echo "  [3/5] Starting meshArchWeb BackEnd"
echo "$DIVIDER"

if ss -tlnp | grep -q ':3000 '; then
    echo "  SKIPPED — port 3000 is already in use (service may already be running)."
    MESH_PID="SKIPPED"
else
    cd /home/ubuntu/meshArchWeb/BackEnd
    nohup npm start > "log_meshArch_${LOG_DATE}.log" 2>&1 &
    MESH_PID=$!
    echo "  Started with PID: $MESH_PID"
fi


# ------------------------------------------------------------
# 4. history-around Back-End
# ------------------------------------------------------------
echo ""
echo "$DIVIDER"
echo "  [4/5] Starting history-around Back-End"
echo "$DIVIDER"

if pgrep -f "history-around/Back-End" > /dev/null; then
    echo "  SKIPPED — history-around is already running (PID: $(pgrep -f history-around/Back-End))."
    HISTORY_PID="SKIPPED"
else
    cd /home/ubuntu/history-around/Back-End
    nohup npm start > "log_history_${LOG_DATE}.log" 2>&1 &
    HISTORY_PID=$!
    echo "  Started with PID: $HISTORY_PID"
fi


# ------------------------------------------------------------
# 5. copyParty
# ------------------------------------------------------------
echo ""
echo "$DIVIDER"
echo "  [5/5] Starting copyParty"
echo "$DIVIDER"

if pgrep -f "copyparty-sfx.py" > /dev/null; then
    echo "  SKIPPED — copyParty is already running (PID: $(pgrep -f copyparty-sfx.py))."
    COPY_PID="SKIPPED"
else
    cd /home/ubuntu/copyParty
    nohup python3 copyparty-sfx.py -c copyparty.conf > "log_${LOG_DATE}.log" 2>&1 &
    COPY_PID=$!
    echo "  Started with PID: $COPY_PID"
fi


# ------------------------------------------------------------
# Wait for services to write their initial output
# ------------------------------------------------------------
echo ""
echo "  Waiting 8 seconds for services to initialise..."
sleep 8


# ------------------------------------------------------------
# Log tails — check for startup errors
# ------------------------------------------------------------
echo ""
echo "============================================================"
echo "  LOG OUTPUT (last 15 lines each)"
echo "============================================================"

echo ""
echo "$DIVIDER"
echo "  adimari-project Backend  [ PID $ADIMARI_PID ]"
echo "  /home/ubuntu/adimari-project/Backend/log_adimari_${LOG_DATE}.log"
echo "$DIVIDER"
tail -n 15 /home/ubuntu/adimari-project/Backend/log_adimari_${LOG_DATE}.log 2>/dev/null || echo "  (no output yet)"

echo ""
echo "$DIVIDER"
echo "  meshArchWeb BackEnd  [ PID $MESH_PID ]"
echo "  /home/ubuntu/meshArchWeb/BackEnd/log_meshArch_${LOG_DATE}.log"
echo "$DIVIDER"
tail -n 15 /home/ubuntu/meshArchWeb/BackEnd/log_meshArch_${LOG_DATE}.log 2>/dev/null || echo "  (no output yet)"

echo ""
echo "$DIVIDER"
echo "  history-around Back-End  [ PID $HISTORY_PID ]"
echo "  /home/ubuntu/history-around/Back-End/log_history_${LOG_DATE}.log"
echo "$DIVIDER"
tail -n 15 /home/ubuntu/history-around/Back-End/log_history_${LOG_DATE}.log 2>/dev/null || echo "  (no output yet)"

echo ""
echo "$DIVIDER"
echo "  copyParty  [ PID $COPY_PID ]"
echo "  /home/ubuntu/copyParty/log_${LOG_DATE}.log"
echo "$DIVIDER"
tail -n 15 /home/ubuntu/copyParty/log_${LOG_DATE}.log 2>/dev/null || echo "  (no output yet)"


# ------------------------------------------------------------
# Quick process check — confirm all 4 are still running
# ------------------------------------------------------------
echo ""
echo "============================================================"
echo "  PROCESS CHECK"
echo "============================================================"

# ------------------------------------------------------------
# Quick process check — confirm all services are running
# ------------------------------------------------------------
echo ""
echo "============================================================"
echo "  PROCESS CHECK"
echo "============================================================"

check_service() {
    local NAME=$1
    local PID=$2
    if [ "$PID" = "SKIPPED" ]; then
        echo "  [ $NAME ]  ->  ALREADY RUNNING (skipped)"
    elif kill -0 $PID 2>/dev/null; then
        echo "  PID $PID  [ $NAME ]  ->  RUNNING"
    else
        echo "  PID $PID  [ $NAME ]  ->  STOPPED (check the log above for errors)"
    fi
}

check_service "adimari-project Backend (port 5001)" "$ADIMARI_PID"
check_service "meshArchWeb BackEnd     (port 3000)" "$MESH_PID"
check_service "history-around Back-End"             "$HISTORY_PID"
check_service "copyParty"                           "$COPY_PID"

echo ""
echo "  Tip: To check a service later, run:"
echo "    tail -f /home/ubuntu/adimari-project/Backend/log_adimari_${LOG_DATE}.log"
echo ""
echo "  Tip: To stop a service, run:"
echo "    kill <PID>"
echo ""
echo "============================================================"
echo "  Startup complete — $(date)"
echo "============================================================"
echo ""
