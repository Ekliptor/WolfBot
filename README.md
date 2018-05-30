# WolfBot
This is the source of the Crypto currency trading bot running on: https://wolfbot.org

It is written in TypeScript for NodeJS + MongoDB.

## Features
* **Trading**: buying + selling, portfolio managament (sync balances with exchanges)
* **Margin Trading**: leveraged trading including short selling and futures trading
* **Arbitrage**: profit from price differences between 2 exchanges (done "on the books" with balances on both exchanges, no withdrawals from exchanges required)
* **Lending**: lend your coins on the lending market of supported crypto exchanges for the highest possible interest rates
* **Backtesting**: test your trade strategies in simulation on historical data
* **Web Plugins**: Access social media data from Twitter, Reddit, Telegram Channels, RSS Feeds,... to trade based on news and real world events

A more detailed list of all features: https://wolfbot.org/features/

The list of supported exchanges: https://wolfbot.org/features/exchanges/

## Getting Started

### Requirements
```
NodeJS >= 9
MongoDB >= 3.4
TypeScript >= 2.8
yarn >= 1.5 (npm should work too)
Webpack >= 4 (only for UI modifications)
```


### Installation
```
git clone https://github.com/Ekliptor/WolfBot
yarn install
```
You can use `--production` flag if you only want to run the bot and not make any code changes.

**IMPORTANT:**
The server-side code is currently **incomplete**. It depends on more of my private modules. I have to cleanup & refactor some code. Also make sure there are no Exchange API keys or other sensitive data left. Please wait 2-4 weeks before running the server code.

Update 2018-05-15: The MongoDB database models are now released here: https://github.com/Ekliptor/bit-models
The code still missing is mostly HTTP helpers, browser functions, auto updater,... stay tuned


### Start trading
Rename the `configLocal-sample.ts` file in the project root directory to `configLocal.ts` and add att least `mongoUrl` (plus some exchange API keys if you want to trade).


After running TypeScript (automatically in your IDE or run the `tsc` command in the project root dir) you will see a file:
```
build/app.js
```
Use the `build` directory as the working directory and run:
```
node app.js --debug --config=Noop --trader=RealTimeTrader --noUpdate --noBrowser
```
The `config` parameter must be a JSON file from the `config` directory. For a list of all parameters look at the top of the `app.ts` file.


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
├─── views <- all HTML templates
```

