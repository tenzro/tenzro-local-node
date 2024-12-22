#!/bin/bash
# scale-heroku.sh

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Function to scale node
scale_node() {
    local APP_NAME=$1
    local DYNO_TYPE=$2
    local DYNO_COUNT=$3

    echo -e "${YELLOW}Scaling $APP_NAME to $DYNO_COUNT x $DYNO_TYPE...${NC}"
    heroku ps:scale web=$DYNO_COUNT:$DYNO_TYPE -a $APP_NAME

    if [ $? -eq 0 ]; then
        echo -e "${GREEN}Successfully scaled $APP_NAME${NC}"
    else
        echo -e "${RED}Failed to scale $APP_NAME${NC}"
        exit 1
    fi
}

# Function to scale node type
scale_node_type() {
    local NODE_TYPE=$1
    local DYNO_COUNT=$2
    
    case $NODE_TYPE in
        "global")
            scale_node "tenzro-global-node-us" "standard-2x" $DYNO_COUNT
            scale_node "tenzro-global-node-eu" "standard-2x" $DYNO_COUNT
            ;;
        "regional")
            scale_node "tenzro-regional-node-us" "standard-1x" $DYNO_COUNT
            scale_node "tenzro-regional-node-eu" "standard-1x" $DYNO_COUNT
            ;;
        "local")
            scale_node "tenzro-local-node-us" "basic" $DYNO_COUNT
            scale_node "tenzro-local-node-eu" "basic" $DYNO_COUNT
            ;;
        *)
            echo -e "${RED}Invalid node type: $NODE_TYPE${NC}"
            echo "Usage: $0 [global|regional|local] [count]"
            exit 1
            ;;
    esac
}

# Main script
if [ $# -ne 2 ]; then
    echo "Usage: $0 [global|regional|local] [count]"
    exit 1
fi

NODE_TYPE=$1
DYNO_COUNT=$2

# Validate dyno count
if ! [[ "$DYNO_COUNT" =~ ^[0-9]+$ ]]; then
    echo -e "${RED}Dyno count must be a positive integer${NC}"
    exit 1
fi

scale_node_type $NODE_TYPE $DYNO_COUNT