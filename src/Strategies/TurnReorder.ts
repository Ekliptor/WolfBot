
// TODO follows a trend until the price goes "setback" percent into the other direction (identical to StopLossTurn)
// once the price reaches "setback" it buys/sells more of the coin, thus reordering more and increasing the current position
// in the market. The underlying assumption is that this turn is just temporarily.
// This regularly happens when coins are rising fast. The only question is how can we "activate" this strategy ? (from another strategy?)