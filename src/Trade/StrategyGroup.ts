import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {TradeConfig} from "../Trade/TradeConfig";
import {Candle, Currency, Trade, Order, Ticker} from "@ekliptor/bit-models";
import {AbstractStrategy, StrategyPosition} from "../Strategies/AbstractStrategy";
import {AbstractStopStrategy} from "../Strategies/AbstractStopStrategy";
import {AbstractTakeProfitStrategy} from "../Strategies/AbstractTakeProfitStrategy";
import {AbstractTriggerOrder} from "../Strategies/AbstractTriggerOrder";

export class StrategyGroup {
    protected strategies: AbstractStrategy[] = [];

    constructor(strategies: AbstractStrategy[], currentStrategy: AbstractStrategy) {
        strategies.forEach((strategy) => {
            if (strategy !== currentStrategy)
                this.strategies.push(strategy)
        })
    }

    public static createGroup(strategies: AbstractStrategy[]) {
        //let group = new StrategyGroup(strategies) // exclude own strategy from group
        strategies.forEach((strategy) => {
            let group = new StrategyGroup(strategies, strategy)
            strategy.setStrategyGroup(group)
        })
    }

    public getAllStrategies() {
        return this.strategies;
    }

    public getMainStrategies() {
        return this.strategies.filter(s => s.isMainStrategy())
    }

    public getActiveMainStrategies() {
        return this.strategies.filter(s => s.isMainStrategy() && s.isActiveStrategy())
    }

    public getStrategyGroupPosition(): StrategyPosition {
        const mainStrategies = this.getMainStrategies(); // should be the same as using all strategies
        if (mainStrategies.length !== 0)
            return mainStrategies[0].getStrategyPosition()
        const allStrategies = this.getAllStrategies();
        if (allStrategies.length !== 0)
            return allStrategies[0].getStrategyPosition();
        return "none"; // unknown, assume none
    }

    public getStrategyByName(name: string): AbstractStrategy {
        for (let i = 0; i < this.strategies.length; i++)
        {
            if (this.strategies[i].getClassName() === name || this.strategies[i].getBacktestClassName() === name)
                return this.strategies[i];
        }
        logger.error("Strategy with name %s not found", name)
        return null;
    }

    public getStopStrategies(): AbstractStopStrategy[] {
        let strategies = [];
        for (let i = 0; i < this.strategies.length; i++)
        {
            if (this.strategies[i] instanceof AbstractStopStrategy)
                strategies.push(this.strategies[i] as AbstractStopStrategy);
        }
        return strategies;
    }

    public getTakeProfitStrategies(): AbstractTakeProfitStrategy[] {
        let strategies = [];
        for (let i = 0; i < this.strategies.length; i++)
        {
            if (this.strategies[i] instanceof AbstractTakeProfitStrategy)
                strategies.push(this.strategies[i] as AbstractTakeProfitStrategy);
        }
        return strategies;
    }

    public getTriggerOrderStrategy(name: string): AbstractTriggerOrder {
        // there can only be 1 strategy
        for (let i = 0; i < this.strategies.length; i++)
        {
            if (this.strategies[i].getClassName() === name || this.strategies[i].getBacktestClassName() === name) {
                if (this.strategies[i] instanceof AbstractTriggerOrder)
                    return this.strategies[i] as AbstractTriggerOrder;
                logger.error("TriggerOrder Strategy with name %s has the wrong type", name)
            }
        }
        logger.error("TriggerOrder Strategy with name %s not found", name)
        return null;
    }

    public getCustomStrategies(filterFn: (strategy: AbstractStrategy) => boolean) {
        return this.strategies.filter(s => filterFn(s))
    }

    public getNearestStop(): number {
        const position = this.getStrategyGroupPosition();
        let stopPrice = position === "long" ? 0.0 : Number.MAX_VALUE;
        const stopStrategies = this.getStopStrategies();
        for (let i = 0; i < stopStrategies.length; i++)
        {
            const curStop = stopStrategies[i].getPositionStopPrice();
            if (curStop <= 0.0 || curStop === Number.MAX_VALUE)
                continue;
            if (position === "long") {
                if (curStop > stopPrice)
                    stopPrice = curStop;
            }
            else if (position === "short") {
                if (curStop < stopPrice)
                    stopPrice = curStop;
            }
        }
        return stopPrice;
    }

    public getNearestTakeProfit(): number {
        const position = this.getStrategyGroupPosition();
        let takeProfitPrice = position === "long" ? Number.MAX_VALUE : 0.0;
        const takeProfitStrategies = this.getTakeProfitStrategies();
        for (let i = 0; i < takeProfitStrategies.length; i++)
        {
            const curProfit = takeProfitStrategies[i].getTakeProfitPrice();
            if (curProfit <= 0.0 || curProfit === Number.MAX_VALUE)
                continue;
            if (position === "long") {
                if (curProfit > takeProfitPrice) // same as for stops as we are interested in the nearest price
                    takeProfitPrice = curProfit;
            }
            else if (position === "short") {
                if (curProfit < takeProfitPrice)
                    takeProfitPrice = curProfit;
            }
        }
        return takeProfitPrice;
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################
}
