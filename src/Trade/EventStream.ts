import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import * as EventEmitter from 'events';
import * as Heap from "qheap";

export interface SequenceItem<T> {
    seqNr: number;
    value: T;
}

/**
 * Emits a stream ordered by the sequence number.
 * Some markert events (on poloniex) can arrive out of order. We have to process them in order.
 */
export default class TradeStream<T> extends EventEmitter {
    protected name: string;
    protected maxPendingValues: number;
    protected lastSeqNr = -1;

    protected heap = new Heap({
        comparBefore(a: SequenceItem<T>, b: SequenceItem<T>) {
            return a.seqNr < b.seqNr;
        },
        compar(a: SequenceItem<T>, b: SequenceItem<T>) {
            return a.seqNr < b.seqNr ? -1 : 1;
        },
        freeSpace: false,
        size: 100
    });

    /**
     * Create a new EventStream instance.
     * You can listen for: instance.on("value", (value, seqNr) => {...})
     * @param name The name of the stream (used for debugging only)
     * @param maxPendingValues The maximum number of waiting events if they arrive out of order.
     * After this limit is reached the stream will just continue emitting with the current values (in ascending order).
     */
    constructor(name: string, maxPendingValues = 10) {
        super();
        this.name = name;
        this.maxPendingValues = maxPendingValues;
    }

    public add(seqNr: number, value: T) {
        // qheap is the fastest priority queue available: https://github.com/lemire/FastPriorityQueue.js
        // but we can be faster by just emitting the value directly if the seqNr is in order
        if (this.lastSeqNr === -1)
            this.lastSeqNr = seqNr-1; // it's the first value coming in

        if (this.lastSeqNr+1 === seqNr) {
            this.lastSeqNr = seqNr;
            this.emit("value", value, seqNr);
        }
        else {
            //this.lastSeqNr = seqNr;
            this.heap.insert({seqNr: seqNr, value: value});
        }
        this.emitNext();
    }

    public getName() {
        return this.name;
    }

    public close() {
        this.removeAllListeners();
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected emitNext() {
        let next = this.heap.peek();
        if (!next)
            return;
        if (this.lastSeqNr+1 === next.seqNr || this.heap.length > this.maxPendingValues) {
            this.lastSeqNr = next.seqNr;
            this.heap.remove();
            this.emit("value", next.value, next.seqNr);
            this.emitNext(); // call it until there is no next value in order
        }
    }
}