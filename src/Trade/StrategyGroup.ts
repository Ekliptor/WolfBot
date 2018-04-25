import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import {TradeConfig} from "../Trade/TradeConfig";
import {Candle, Currency, Trade, Order, Ticker} from "@ekliptor/bit-models";
import {AbstractStrategy} from "../Strategies/AbstractStrategy";
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

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################
}