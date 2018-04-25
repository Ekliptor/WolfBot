#!/bin/bash
# run as non-root user (root for nginx temp dir cleanup + permissions)
# */5 * * * * /home/bitbrain/nodejs/BitBrain/restart.sh >/dev/null 2>&1
# su -c "/home/..." bitbrain
# run quietly from /etc/rc.local: su -c "/home/bitbrain/nodejs/BitBrain/restart.sh >/dev/null 2>&1" bitbrain

BASE_NAME="Sensor"
DIR="/home/bitbrain/nodejs/BitBrain/"
NODE="/usr/local/bin/node" # when using n for updates we get it installed to /local - otherwise /usr/bin/node
NODE_ARGS="--max-old-space-size=3524"
LAST_PARAMS_FILE="LastParams.txt"
BOT_START_FILE="/app.js " # keep the space at the end
PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin:/bin

# default params. we write LastConfig.txt file into bot dir (with nodejs) and read it to restart the bot with the same params
botlist=(
     'Sensor1/app.js --config=Reddit --social -p=8443'
     'Sensor2/app.js --config=PoloStops --trader=RealTimeTrader -p=8234'
     'Sensor3/app.js --config=PlanRunner --trader=RealTimeTrader -p=5743'
     'Sensor4/app.js --config=Bitfinex --lending -p=2888'
     'Sensor5/app.js --config=DirectionFollowerFutures --trader=RealTimeTrader -p=2095'
     'Sensor6/app.js --config=DirectionFollower --trader=RealTimeTrader -p=5733'
   )

#for i in {1..7}
count=0
# loop until we find an empty string
while [ "x${botlist[count]}" != "x" ]
do
    sensorCount=$(( $count + 1 )) # our bot dirs start at 1
    #NAME="$BASE_NAMEx${botlist[count]}"
    NAME="$BASE_NAMEx${botlist[count]}"
    SHORT_NAME="$BASE_NAME$sensorCount"
    PARAMS=$(cat "$DIR$SHORT_NAME/$LAST_PARAMS_FILE")
    echo -e "checking $SHORT_NAME\n"
    echo -e "full name $NAME\n"
    count=$(( $count + 1 ))
    # remove grep and runuser (+ children) from output
    PID=$(ps aux | grep "$SHORT_NAME" | grep -v grep | grep -v runuser | grep -v bash | grep -v nohup | grep -v child | awk '{print $2}')

    # force restart
    if [ "$1" == "restart" ];
    then
      if kill -0 $PID
      then
        kill -s 15 $PID # SIGTERM
      fi
      sleep 3
    fi

    if kill -0 $PID
    then
      echo -e "$SHORT_NAME is currently running, the PID is $PID\n"
    else
      echo -e "Restarting $SHORT_NAME!\n"

      # delete nginx temp data
      if [[ "$EUID" -eq 0 ]];
      then
        rm -r /tmp/nginx && /bin/mkdir /tmp/nginx && /bin/chown www-data.www-data /tmp/nginx
      fi

      # prepare environment
      export NODE_ENV=production
      #export PORT=3521
      #export HOST=staydown.co

      # restart in background
      sleep 5
      if [[ -z $PARAMS ]];
      then
        cd $DIR$SHORT_NAME && nohup $NODE $NODE_ARGS $DIR$NAME > /dev/null & echo $!
      else
        echo -e "Starting $SHORT_NAME with previous parameters\n"
        cd $DIR$SHORT_NAME && nohup $NODE $NODE_ARGS $DIR$SHORT_NAME$BOT_START_FILE$PARAMS > /dev/null & echo $!
      fi
    fi
done