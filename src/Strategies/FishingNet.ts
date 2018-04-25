
// TODO https://cryptotrader.org/topics/501391/fisherman-s-friend-margin-bot-proposal
// A Strategy that starts buying amounts on/after a peak as the price declines.
// It starts with small amounts and increases the size of the orders as the price goes down (thus dividing the total order
// size into chunks of increasing size). As the prices falls into this "fishing net", our losses increase, but since we bought
// larger amounts at a lower price it doesn't take long to get a profit at any point as soon as the market turns.