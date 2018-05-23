// object extensions from apputils
import {IncomingMessage} from "http";

interface String {
    replaceAll: (search: string, replace: string) => string;
}

interface Map<K, V> {
    toObject: () => any;
    toArray: () => any[];
    toToupleArray:<V> () => [string, V][]; // MapToupleArray
}

interface Set<T> {
    toObject: () => any;
    toArray: () => any[];
}

interface Array<T> {
    mathMax: () => number;
    mathMin: () => number;

    arrayDiff: (arr: any[]) => any[];
    shuffle: () => void;
}

interface WebSocket {
    id: string;
}

interface IncomingMessage { // part of multihttpdispatcher module
    query: {
        [key: string] : string;
    }
    params: {
        [key: string] : string;
    }
}