
export class GlobalTradeSignal extends Map<number, string> { // (unique ID, signal)
    protected counter: number = 0;

    constructor(iterable?: Iterable<[number, string]>) {
        super(iterable);
    }

    /*
    public set(id: number, signal: string): this {
        throw new Error("set() should not be called on GlobalTradeSignal. Use addSignal() instead.");
        return this;
    }
     */

    public addSignal(signal: string): boolean {
        this.set(++this.counter, signal);
        return true;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

}
