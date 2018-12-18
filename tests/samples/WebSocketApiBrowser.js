// Example for the browser of how to connect to WolfBot using WebSockets to receive
// - live trades data
// - live strategy data


class WolfbotWebsocketAPI {
    constructor() {
        // WOLFBOT_API_KEY is the api key of your WolfBot instance
        this.ws = new WebSocket('wss://hostname:port/?apiKey=WOLFBOT_API_KEY&format=json');

        // add WebSocket event listeners
        this.ws.onerror = (error) => {
            console.log("WebSocket error", error);
        }
        this.ws.onopen = (event) => {
            setTimeout(() => { // delay needed since new websocket module
                // subscribe to desired data feeds
                this.send(12, {action: "sub"}); // strategy live data
                this.send(24, {action: "sub"}); // trades
                //this.send(12, {tabNr: 3}); // subscribes to conifg number 3 (instead of 1, default) for strategy data
            }, 100);
        }
        this.ws.onmessage = (event) => {
            this.processResponse(event.data);
        }
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

var socket = new WolfbotWebsocketAPI();

