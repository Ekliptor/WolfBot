
// TODO http://stockcharts.com/school/doku.php?id=chart_school:technical_indicators:commodity_channel_index_cci
/**
 * { name: 'CCI',
  group: 'Momentum Indicators',
  hint: 'Commodity Channel Index',
  inputs: [ { name: 'inPriceHLC', type: 'price', flags: [Object] } ],
  optInputs:
   [ { name: 'optInTimePeriod',
       displayName: 'Time Period',
       defaultValue: 14,
       hint: 'Number of period',
       type: 'integer_range' } ],
  outputs: [ { '0': 'line', name: 'outReal', type: 'real', flags: {} } ] }
 */