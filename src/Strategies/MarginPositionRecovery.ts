
// TODO A strategy that recovers a margin position which is currently at a loss (without closing it in between trades).
// Works well together with StopLossTurnPartial to prevent further losses.

// config
// targetGain - the % gain/loss when the position shall be closed. negative for loss
// minGainRun - the min % gain per single buy/sell run
// trailingTakeProfitStop - the trailing stop in % that wll be placed after minGainRun is reached