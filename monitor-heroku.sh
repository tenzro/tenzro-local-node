#!/bin/bash
# monitor-heroku.sh

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Function to check app metrics
check_app_metrics() {
    local APP_NAME=$1
    echo -e "${YELLOW}Checking metrics for $APP_NAME...${NC}"
    
    # Check dyno status
    echo "Dyno Status:"
    heroku ps -a $APP_NAME

    # Check logs for errors
    echo -e "\nRecent Errors:"
    heroku logs --tail=100 -a $APP_NAME | grep -i error || echo "No recent errors"

    # Check response time metrics
    echo -e "\nResponse Times:"
    heroku logs --tail=100 -a $APP_NAME | grep "service=" || echo "No metrics available"

    # Check memory usage
    echo -e "\nMemory Usage:"
    heroku ps:metrics memory -a $APP_NAME

    echo "----------------------------------------"
}

# Function to check node health
check_node_health() {
    local APP_NAME=$1
    local URL="https://${APP_NAME}.herokuapp.com/health"
    
    echo -e "${YELLOW}Checking health for $APP_NAME...${NC}"
    
    response=$(curl -s -w "\n%{http_code}" "$URL")
    status_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | head -n1)
    
    if [ "$status_code" -eq 200 ]; then
        echo -e "${GREEN}✓ Node is healthy${NC}"
        echo "Health details:"
        echo "$body" | python -m json.tool
    else
        echo -e "${RED}✗ Node is unhealthy (Status: $status_code)${NC}"
        echo "$body"
    fi
    echo "----------------------------------------"
}

# Function to check network status
check_network_status() {
    local APP_NAME=$1
    local URL="https://${APP_NAME}.herokuapp.com/api/network/status"
    
    echo -e "${YELLOW}Checking network status for $APP_NAME...${NC}"
    
    response=$(curl -s -w "\n%{http_code}" "$URL")
    status_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | head -n1)
    
    if [ "$status_code" -eq 200 ]; then
        echo -e "${GREEN}✓ Network status available${NC}"
        echo "Network details:"
        echo "$body" | python -m json.tool
    else
        echo -e "${RED}✗ Could not get network status (Status: $status_code)${NC}"
        echo "$body"
    fi
    echo "----------------------------------------"
}

# Check Global Nodes
echo -e "${YELLOW}Monitoring Global Nodes...${NC}"
check_app_metrics "tenzro-global-node-us"
check_node_health "tenzro-global-node-us"
check_network_status "tenzro-global-node-us"

check_app_metrics "tenzro-global-node-eu"
check_node_health "tenzro-global-node-eu"
check_network_status "tenzro-global-node-eu"

# Check Regional Nodes
echo -e "${YELLOW}Monitoring Regional Nodes...${NC}"
check_app_metrics "tenzro-regional-node-us"
check_node_health "tenzro-regional-node-us"
check_network_status "tenzro-regional-node-us"

check_app_metrics "tenzro-regional-node-eu"
check_node_health "tenzro-regional-node-eu"
check_network_status "tenzro-regional-node-eu"

# Check Local Nodes
echo -e "${YELLOW}Monitoring Local Nodes...${NC}"
check_app_metrics "tenzro-local-node-us"
check_node_health "tenzro-local-node-us"

check_app_metrics "tenzro-local-node-eu"
check_node_health "tenzro-local-node-eu"