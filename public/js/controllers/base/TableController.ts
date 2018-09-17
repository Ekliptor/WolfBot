//import {AbstractWidget} from "../classes/AbstractWidget";
import {ClientSocketReceiver, ClientSocket} from "../../classes/WebSocket/ClientSocket";
import * as $ from "jquery";
import * as i18next from "i18next";
import {AbstractController} from "./AbstractController";

export abstract class TableController extends AbstractController {
    constructor(socket: ClientSocket) {
        super(socket)
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected getTableOpts() {
        return { // fails to render pagination if called too early
            "pageLength": 50, // default otherwise is to select the first from lengthMenu
            "lengthMenu": [[50, 100, 250, -1], [50, 100, 250, i18next.t("all")]],
            //"searching": false, // removes the input box too
            "language": {
                "aria": {
                    "sortAscending": ": " + i18next.t("sortAscending"),
                    "sortDescending": ": " + i18next.t("sortDescending")
                },
                "paginate": {
                    "first": i18next.t("first"),
                    "last": i18next.t("last"),
                    "next": i18next.t("next"),
                    "previous": i18next.t("previous")
                },
                "emptyTable": i18next.t("noDataAvailable"),
                //"infoPostFix": " " + i18next.t("bracket_l") + i18next.t("realTimeData") + i18next.t("bracket_r"),
                "infoPostFix": "",
                "loadingRecords": i18next.t("loadingWait"),
                "processing": i18next.t("processingWait"),
                "search": i18next.t("filter") + i18next.t("colon"),
                //"search": "Apply filter _INPUT_ to table"
                //"url": "lang.json", // keys starting with s (sInfo) http://cdn.datatables.net/plug-ins/9dcbecd42ad/i18n/German.json
                "decimal": i18next.t("decimalSeparator"),
                "thousands": i18next.t("thousandSeparator"),
                "lengthMenu": i18next.t("lengthTableMenu"),
                "zeroRecords": i18next.t("nothingFound"),
                //"info": i18next.t("pageOf"),
                "info": i18next.t("entriesOf"),
                "infoEmpty": i18next.t("noRecords"),
                "infoFiltered": i18next.t("bracket_l") + i18next.t("filteredRecords") + i18next.t("bracket_r")
            },
            "createdRow": function (row, data, index) {
                // row: html string of the row
                // data: array with all the colums and their data as string
                // index: number of the row
                //if ($('#worksTable').length !== 0)
            }
        }
    }

    protected prepareTable(tableOptions, tableSel: string, header: boolean) {
        let checkRow = header ? 'th' : 'td';
        let firstRow = $(tableSel + ' tr').eq(header ? 0 : 2); // 0 = thead, 1 = tfoot
        let numberCols = $(tableSel + ' tr:first th').length;
        if ($(tableSel + ' ' + checkRow + '.dateTime, ' + tableSel + ' ' + checkRow + '.decimalNumber').length !== 0) {
            // setup type options for sorting of columns
            tableOptions["aoColumns"] = [];
            let dateIndex = [];
            let numberIndices = [];

            // recognize advanced sorting based on css classes of the table
            $(checkRow, firstRow).each((function(i, element) {
                let el = $(element);
                if (el.hasClass('dateTime'))
                    dateIndex.push(i);
                else if (el.hasClass('decimalNumber'))
                    numberIndices.push(i);
            }));
            for (let i = 0; i < numberCols; i++)
            {
                if (dateIndex.indexOf(i) !== -1) // add date colums with unix timestamps for sorting
                    tableOptions["aoColumns"].push({"sType": "dynamic-number"});
                else if (numberIndices.indexOf(i) !== -1) // add other decimal numbers
                    tableOptions["aoColumns"].push({"sType": "dynamic-number"});
                else
                    tableOptions["aoColumns"].push(null);
            }
        }
        // set default sorting on page load
        if ($(tableSel).length !== 0) {
            // new way: .sortAsc and .sortDesc classes on table header
            let headerCols = $(tableSel + ' tr').eq(0).find('th');
            let tableOrder = [];
            headerCols.each((function(i, element) {
                let el = $(element);
                if (el.hasClass("sortAsc"))
                    tableOrder.push([i, "asc"]);
                else if (el.hasClass("sortDesc"))
                    tableOrder.push([i, "desc"]);
            }));
            if (tableOrder.length !== 0)
                tableOptions["order"] = tableOrder;
        }
        if ($(tableSel + ' ' + checkRow + '.num').length !== 0) {
            if (!tableOptions["aoColumns"])
                tableOptions["aoColumns"] = []
            let simpleNumberIndices = [];
            $(checkRow, firstRow).each(function(i, element) {
                let el = $(element);
                if (el.hasClass('num'))
                    simpleNumberIndices.push(i);
            });
            // recognize default sorting for numeric values
            for (let i = 0; i < numberCols; i++)
            {
                if (tableOptions["aoColumns"][i])
                    continue;
                if (simpleNumberIndices.indexOf(i) !== -1)
                    tableOptions["aoColumns"][i] = {"sType": "static-number"};
                else //if (!tableOptions["aoColumns"][i])
                    tableOptions["aoColumns"][i] = null;
            }
        }

        // add export buttons
        // too many dependencies
        // https://datatables.net/extensions/buttons/examples/initialisation/export.html
        /*
        if ($(tableSel + '.export').length !== 0) {
            tableOptions["dom"] = 'Blfrtip'; // order of control elements
            tableOptions.buttons = [
                'copy', 'csv', 'excel', 'pdf', 'print'
            ];
        }
        */
        if ($(tableSel).hasClass('noPagination')) // TODO add support for multiple .jsTables with different options on a single page
            tableOptions["bPaginate"] = false;
        return tableOptions;
    }

    protected moveTimestampsToParent(tableSel: string, columIndices: number[]) {
        $(tableSel + " tr").each((index: number, elem: Element) => {
            let cols = $(elem).find("td");
            cols.each((colI: number, colElem: Element) => {
                if (columIndices.indexOf(colI) !== -1) {
                    let el = $(colElem);
                    let sortVal = el.find("span").attr("data-sort");
                    if (sortVal) // header won't have this value (should't have dateTime class neither)
                        el.attr("data-time", sortVal);
                }
            });
        });
    }

    protected replaceClasses(tableSel: string, columIndices: number[], removeClass: string, addClass?: string) {
        let replace = (index: number, elem: Element) => {
            let el = $(elem);
            if (!removeClass || el.hasClass(removeClass) === true) {
                if (removeClass)
                    el.removeClass(removeClass);
                if (addClass)
                    el.addClass(addClass);
            }
        }
        let replaceOps = [" thead th", " tfoot th"];
        replaceOps.forEach((op) => {
            $(tableSel + op).each((index: number, elem: Element) => {
                if (columIndices.indexOf(index) !== -1)
                    replace(index, elem)
            });
        });
    }
}