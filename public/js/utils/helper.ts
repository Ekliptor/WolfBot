
/**
 * Returns the % difference between value1 and value2
 * @param value1
 * @param value2
 * @returns {number} the % difference > 0 if value1 > value2, < 0 otherwise
 */
export function getDiffPercent(value1: number, value2: number) {
    return ((value1 - value2) / value2) * 100; // ((y2 - y1) / y1)*100 - positive % if value1 > value2
}
