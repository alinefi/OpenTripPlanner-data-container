#!/bin/bash
set +e

# set defaults
ORG=${ORG:-hsldevcom}
JAVA_OPTS=${JAVA_OPTS:--Xmx9g}
ROUTER_NAME=${ROUTER_NAME:-hsl}
OTP_TAG=${OTP_TAG:-v2}
TOOLS_TAG=${TOOLS_TAG=:-v3}
DOCKER_IMAGE=$ORG/opentripplanner-data-container-$ROUTER_NAME:test
[name, process.env.OTP_TAG || 'v2', process.env.TOOLS_TAG || ''],

function shutdown() {
  echo shutting down
  docker stop otp-data-$ROUTER_NAME || true
  docker stop otp-$ROUTER_NAME || true
}

echo -e "\n##### Testing $ROUTER_NAME ($DOCKER_IMAGE)#####\n"

echo "Starting data container..."
docker run --rm --name otp-data-$ROUTER_NAME $DOCKER_IMAGE > /dev/stdout &
sleep 120

echo "Starting otp..."

docker run --rm --name otp-$ROUTER_NAME -e ROUTER_NAME=$ROUTER_NAME -e JAVA_OPTS="$JAVA_OPTS" -e ROUTER_DATA_CONTAINER_URL=http://otp-data:8080/ --link otp-data-$ROUTER_NAME:otp-data $ORG/opentripplanner:$OTP_TAG > /dev/stdout &

sleep 5

echo "Getting otp ip.."
timeout=$(($(date +%s) + 480))
until IP=$(docker inspect --format '{{ .NetworkSettings.IPAddress }}' otp-$ROUTER_NAME) || [[ $(date +%s) -gt $timeout ]]; do sleep 1;done;

if [ "$IP" == "" ]; then
  echo "Could not get ip. failing test"
  shutdown
  exit 1
fi

echo "Got otp ip: $IP"

date=$(date '+%Y%m%d')

if [ "$ROUTER_NAME" == "hsl" ]; then
    MAX_WAIT=30
    URL="http://$IP:8080/otp/routers/default/plan?fromPlace=60.19812876015124%2C24.934051036834713&toPlace=60.218630210423306%2C24.807472229003906&date=${date}&time=14:00"
elif [ "$ROUTER_NAME" == "waltti" ]; then
    MAX_WAIT=60
    URL="http://$IP:8080/otp/routers/default/plan?fromPlace=60.44638185995603%2C22.244396209716797&toPlace=60.45053041945487%2C22.313575744628906&date=${date}&time=14:00"
elif [ "$ROUTER_NAME" == "waltti-alt" ]; then
    MAX_WAIT=60
    URL="http://$IP:8080/otp/routers/default/plan?fromPlace=60.36627023055039%2C23.1210708618164&toPlace=60.40639308599%2C23.185958862&date=${date}&time=14:00"
elif [ "$ROUTER_NAME" == "varely" ]; then
    MAX_WAIT=60
    URL="http://$IP:8080/otp/routers/default/plan?fromPlace=60.629165131895085%2C22.05413103103638&toPlace=60.44274085084863%2C22.288684844970703&date=${date}&time=14:00"
else
    MAX_WAIT=60
    URL="http://$IP:8080/otp/routers/default/plan?fromPlace=60.19812876015124%2C24.934051036834713&toPlace=60.218630210423306%2C24.807472229003906&date=${date}&time=14:00"
fi

ITERATIONS=$(($MAX_WAIT * 6))
echo "max wait (minutes): $MAX_WAIT"

for (( c=1; c<=$ITERATIONS; c++ ));do
  STATUS_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://$IP:8080/otp/routers/default || true)

  if [ $STATUS_CODE = 200 ]; then
    echo "OTP started"
    curl -s "$URL"|grep error
    if [ $? = 1 ]; then #grep finds no error
	echo "OK"
    break
    else
	echo "ERROR"
	shutdown
	exit 1;
    fi
  else
    echo "waiting for service"
    sleep 10
  fi
done

echo "running otpqa"
docker pull $ORG/otp-data-tools:$TOOLS_TAG
docker run --rm --name otp-data-tools $ORG/otp-data-tools:$TOOLS_TAG /bin/sh -c "cd OTPQA; python otpprofiler_json.py http://$IP:8080/otp/routers/default $ROUTER_NAME $SKIPPED_SITES"
if [ $? == 0 ]; then
  docker cp otp-data-tools:/OTPQA/failed_feeds.txt .
  shutdown
  exit 0
else
  shutdown
  exit 1
fi


