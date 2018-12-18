// Example for NodeJS of how to connect to WolfBot using WebSockets to receive
// - live trades data
// - live strategy data

//const WebSocket = require('ws');


class WolfbotWebsocketAPI {
    constructor() {
        // WOLFBOT_API_KEY is the api key of your WolfBot instance
        this.ws = new WebSocket('wss://hostname:port/?apiKey=WOLFBOT_API_KEY&format=json', {
            //rejectUnauthorized: false // use this on your local machine with a self-signed for WolfBot certificate ONLY
        });

        // add WebSocket event listeners
        this.ws.on('open', () => {
            // subscribe to desired data feeds
            this.send(12, {action: "sub"}); // strategy live data
            this.send(24, {action: "sub"}); // trades
            //this.send(12, {tabNr: 3}); // subscribes to conifg number 3 (instead of 1, default) for strategy data
        });

        this.ws.on('close', (code, reason) => {
            console.log("WS connection closed with code %s", code);
        });

        this.ws.on('message', (data) => {
            this.processResponse(data);
        });

        this.ws.on('error', (err) => {
            console.error("WS error", err);
        });
    }

    send(opcode, data) {
        let dataOut = [opcode, data]; // [opcode, payload]
        this.ws.send(JSON.stringify(dataOut), (err) => {
            if (err)
                console.error("Error sending WS data", err);
        });
    }

    processResponse(data) {
        try {
            data = JSON.parse(data);
        }
        catch (err) {
            console.error("Error parsing JSON response", err);
            return;
        }
        if (Array.isArray(data) === false || data.length < 2) {
            console.error("Received invalid data", data);
            return;
        }
        const opcode = data[0];
        const payload = data.slice(1)[0];
        switch (opcode)
        {
            case 5: // ping
                break;
            case 12: // strategies
                if (payload.full) {
                    console.log("Received full initial strategy data", payload)
                }
                else if (payload.config) {
                    console.log("Received strategy update for current view", payload)
                }
                break;
            case 24: // trades
                break;
            default:
                console.log("Unknown data with opcode %s:", opcode, payload);
        }
    }
}

let socket = new WolfbotWebsocketAPI();

