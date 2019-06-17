import * as utils from "@ekliptor/apputils";
const logger = utils.logger
    , nconf = utils.nconf;
import * as imaps from "imap-simple";

export class MailboxAccount {
    public email: string = "";
    public password: string = "";
    public host: string = ""; // leave empty to automatically set by testing known subdomains
    public port: number = 993;
    public tls: boolean = true;
    public rejectSelfSignedCertificate = true;
    constructor(email: string, password: string) {
        this.email = email;
        this.password = password;
    }
}

export class IncomingMail {
    public readonly uuid: number;
    public from: string;
    public to: string;
    public subject: string;
    public received: Date;
    public contentType: string;
    public rawHeaders: {
        [name: string]: string[];
    }
    public message: string;

    constructor(uuid: number) {
        this.uuid = uuid;
    }
}

export class MailFetchCriteria {
    public inboxName: string = "INBOX";
    public searchCriteria: (string | string[])[] = ["UNSEEN"];
    public markSeen: boolean = true;
}

export class Mailbox {
    public static readonly AUTH_TIMEOUT_MS = 5000;
    public static readonly IMAP_SUBDOMAINS = ["imap", "mail"]; // default fallbacks to try
    // (mail host, subdomain)
    public static readonly SUBDOMAIN_MAP = new Map<string, string>([
        ["gmail.com", "imap.gmail.com"],
        ["yandex.com", "imap.yandex.com"],
        ["wolfbot.org", "mail.wolfbot.org"]
    ]);

    protected account: MailboxAccount;
    protected connection: imaps.ImapSimple = null;

    constructor(account: MailboxAccount) {
        this.account = account;
    }

    public async connect(): Promise<void> {
        this.close();
        if (this.account.host)
            return this.tryConnectToHost(this.account.host); // only connect to this host

        // else try to find the proper host config and only throw error on last failure
        let start = this.account.email.indexOf("@");
        let mailDomain = "";
        if (start !== -1)
            mailDomain = this.account.email.substr(start+1);
        if (mailDomain.length === 0 || mailDomain.indexOf(".") === -1)
            throw new Error("Email address doesn't contain a valid domain");
        let knownMailDomain = Mailbox.SUBDOMAIN_MAP.get(mailDomain);
        if (knownMailDomain !== undefined) {
            try {
                await this.tryConnectToHost(knownMailDomain);
                //if (this.connection !== null) // always fail for known mailboxes (don't try alternative subdomains)
                    //return;
            }
            catch (err) {
                logger.warn("Error connecting to known mailbox on %s", knownMailDomain, err); // continue with defaults below
            }
            if (this.connection === null)
                throw new Error("Failed to connect to known mailbox of account: " + this.account.email);
        }
        for (let i = 0; i < Mailbox.IMAP_SUBDOMAINS.length; i++)
        {
            let host = Mailbox.IMAP_SUBDOMAINS[i] + "." + mailDomain;
            try {
                await this.tryConnectToHost(host);
                if (this.connection !== null)
                    break;
            }
            catch (err) {
                logger.warn("Error connecting to mailbox on %s", host, err);
            }
        }
        if (this.connection === null)
            throw new Error("Failed to connect to mailbox of account: " + this.account.email);
    }

    public close() {
        try {
            if (this.connection !== null)
                this.connection.end();
            this.connection = null;
        }
        catch (err) {
            logger.error("Error disconnecting from mailbox", err);
        }
    }

    public async getMails(criteria: MailFetchCriteria = new MailFetchCriteria()): Promise<IncomingMail[]> {
        let mails: IncomingMail[] = [];
        try {
            let boxName = await this.connection.openBox(criteria.inboxName);
            let fetchOptions = {
                bodies: ['HEADER', 'TEXT'],
                markSeen: criteria.markSeen === true
            };
            let results = await this.connection.search(criteria.searchCriteria, fetchOptions);
            results.forEach((result) => {
                let mail = new IncomingMail(result.attributes.uid);
                result.parts.forEach((mailPart) => {
                    if (mailPart.which === "HEADER")
                        this.readMailHeader(mail, mailPart);
                    else if (mailPart.which === "TEXT")
                        this.readMailText(mail, mailPart);
                    else
                        logger.warn("Can not read unknown mail part of type %s", mailPart.which);
                });
                mails.push(mail);
            });
            /* // might be unsafe
            if (true) {
                this.moveMail(results as any, "TRASH");
                // also needs a label https://github.com/mscdex/node-imap/issues/71
            }
            */
        }
        catch (err) {
            logger.error("Error getting mails from mailbox %s", criteria.inboxName, err);
        }
        return mails;
    }

    /**
     * Adds a flag to the specified message.
     * @param messageUUID SEEN|ANSWERED|FLAGGED|DELETED|DRAFT
     * @param flag
     */
    public async addMessageFlags(messageUUID: string, flag: string | string[]): Promise<void> {
        try {
            await this.connection.addFlags(messageUUID, flag);
        }
        catch (err) {
            logger.error("Error adding email flags %s to message UUID %s", flag, messageUUID, err);
        }
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected async tryConnectToHost(host: string): Promise<void> {
        let config = {
            imap: {
                user: this.account.email,
                password: this.account.password,
                host: host,
                port: this.account.port,
                tls: this.account.tls,
                tlsOptions: {},
                keepalive: true,
                authTimeout: Mailbox.AUTH_TIMEOUT_MS,
                /*connTimeout: 3*Mailbox.AUTH_TIMEOUT_MS,
                debug(msg) {
                    logger.verbose("Mailbox: %s", msg);
                }*/
            }
        };
        if (this.account.rejectSelfSignedCertificate === false) {
            config.imap.tlsOptions = {
                //secureProtocol: 'SSLv3_method',
                rejectUnauthorized: false
            }
        }
        this.connection = await imaps.connect(config);
    }

    protected readMailHeader(mail: IncomingMail, header: imaps.MessageBodyPart) {
        for (let prop in header.body)
        {
            switch (prop) {
                case "content-type":
                    mail.contentType = header.body[prop][0];
                    break;
                case "from":
                    mail.from = header.body[prop][0];
                    break;
                case "to":
                    mail.to = header.body[prop][0];
                    break;
                case "subject":
                    mail.subject = header.body[prop][0];
                    break;
                case "date":
                    mail.received = new Date(header.body[prop][0]);
                    break;
            }
        }
        mail.rawHeaders = header.body;
    }

    protected readMailText(mail: IncomingMail, header: imaps.MessageBodyPart) {
        mail.message = header.body;
    }
}