//import {AbstractWidget} from "../classes/AbstractWidget";
import {ClientSocketReceiver, ClientSocket} from "../../classes/WebSocket/ClientSocket";
import * as $ from "jquery";
import * as i18next from "i18next";
import {AbstractController} from "./AbstractController";

export abstract class JsonEditor extends AbstractController {
    constructor(socket: ClientSocket) {
        super(socket)
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

}