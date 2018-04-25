# WolfBot
This is the source of the Crypto currency trading bot running on https://wolfbot.org. It is written in TypeScript for NodeJS.

## Getting Started

### Requirements
```
NodeJS >= 9
TypeScript >= 2.8
yarn >= 1.5 (npm should work too)
Webpack >= 3 (only for UI modifications)
```


### Installation
```
git clone https://github.com/Ekliptor/WolfBot
yarn install
```
You can use `--production` flag if you only want to run the bot and not make any code changes.

**IMPORTANT:**
The server-side code is currently **incomplete**. It depends on more of my private modules. I have to cleanup & refactor some code. Also make sure there are no Exchange API keys or other sensitive data left. Please wait 2-4 weeks before running the server code.


### Modifying the UI
In the project root directory, run:
```
webpack --progress --colors --watch
```
The UI uses a single persistent WebSocket connection. UI related code is in the following directories:
```
├ project root
├─── public <- all code shipped to the browser
├────── js <- all TypeScript code to be compiled with WebPack
├─── src
├────── WebSocket <- all server-side logic to push updates to the browser
```

