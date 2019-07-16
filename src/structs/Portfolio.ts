import * as utils from "@ekliptor/apputils";
import {CoinMap, MarginPositionMap} from "../Trade/PortfolioTrader";
import {MarginPositionList} from "./MarginPosition";
const logger = utils.logger
    , nconf = utils.nconf;


export class Portfolio {
    public readonly marginPositions: MarginPositionMap;
    public readonly coinBalances: CoinMap;

    constructor(marginPositions = new MarginPositionMap(), coinBalances = new CoinMap()) {
        this.marginPositions = marginPositions;
        this.coinBalances = coinBalances;
    }

    public static unserialize(data: string): Portfolio {
        let json = utils.parseJson(data);
        if (json === null || !json.date) {
            logger.warn("Can not restore unknown portfolio data");
            return new Portfolio();
        }
        let positions = new MarginPositionMap(json.marginPositions);
        let coinBalances = new CoinMap(json.coinBlalances);
        const portfolio = new Portfolio(positions, coinBalances);
        return portfolio;
    }

    public serialize(): string {
        let state = {
            date: new Date(),
            //marginPositions: this.marginPositions.toToupleArray(),
            marginPositions: this.toToupleArray(this.marginPositions),
            coinBalances: this.coinBalances.toToupleArray()
        }
        return JSON.stringify(state);
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected toToupleArray(map: Map<string, any>) {
        let array: utils.objects.MapToupleArray<any>[] = []
        let keys = map.keys()
        for (let m of map)
        {
            const k = m[0];
            let value = map.get(k);
            if (value instanceof Map || value instanceof MarginPositionList)
                value = this.toToupleArray(value);
            array.push([k, value])
        }
        return array
    }
}