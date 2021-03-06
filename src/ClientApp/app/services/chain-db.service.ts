﻿import { Injectable, Injector } from '@angular/core';
import { Observable } from "rxjs/Observable";
import 'rxjs/add/observable/of';
import { ConfigurationService } from "./configuration.service";
import { EndpointFactory } from "./endpoint-factory.service";
import { Http, Headers, Response, RequestOptions } from "@angular/http";
import { Router } from "@angular/router";
import { Pager } from "../models/pager.model";
import { ChainDb, HistoryEntry, QueryTableResponse, RowDef, ColumnDef, Transaction, QueryCellResponse, DataAction, StatusRpcResponse, ListTablesRpcResponse, QueryDataRpcResponse, QueryChainRpcResponse, QueryCellRpcResponse, CreateTransactionRpcResponse, ListTableSchema } from '../models/chain-db.model';
import { LocalStoreManager } from './local-store-manager.service';
import { AlertConfiguration } from '../models/alert.model';
import { CryptographyService } from './cryptography.service';
import { NotificationService } from './notification.service';

export type ChainDbRpcMethod =
    "Status" |
    "CreateSchemaTransaction" |
    "CreateDataTransaction" |
    "QueryData" |
    "QueryChain" |
    "QueryCell" |
    "ListTables"
    ;
@Injectable()
export class ChainDbService extends EndpointFactory {
    private readonly _baseUrl: string = "";
    get baseUrl() { return this.configurations.baseUrl + this._baseUrl; }

    public static readonly DBKEY_CHAIN_DB_DATA = "chain_db";
    public static readonly DBKEY_CHAIN_DB_ALERT_CONFIGURATIONS = "alert_config";

    constructor(
        http: Http,
        configurations: ConfigurationService,
        injector: Injector,
        private localStoreManager: LocalStoreManager,
        private cryptoService: CryptographyService,
        private notificationService: NotificationService,
    ) {
        super(http, configurations, injector);
    }

    getDbList(pager?: Pager): Observable<Array<ChainDb>> {
        if (!this.localStoreManager.exists(ChainDbService.DBKEY_CHAIN_DB_DATA)) {
            this.localStoreManager.savePermanentData([], ChainDbService.DBKEY_CHAIN_DB_DATA);
        }
        var dblist = this.localStoreManager.getData(ChainDbService.DBKEY_CHAIN_DB_DATA);
        return Observable.of(dblist);
    }

    getRecommendDbList(pager?: Pager): Observable<Array<ChainDb>> {
        var dblist: Array<ChainDb> = [
            {
                id: "1",
                name: "备份灯火计划捐赠数据",
                description: "由。。。运营，保存有从xxx开始的数据，为实时数据，接受大众监督。由。。。运营，保存有从xxx开始的数据，为实时数据，接受大众监督。由。。。运营，保存有从xxx开始的数据，为实时数据，接受大众监督。",
                address: "http://localhost:7847/api/rpc",
                image: "https://placeimg.com/200/200/any",
            },
            {
                id: "2",
                name: "XXXX捐赠数据",
                description: "由。。。运营，保存有从xxx开始的数据，为实时数据，接受大众监督。由。。。运营，保存有从xxx开始的数据，为实时数据，接受大众监督。由。。。运营，保存有从xxx开始的数据，为实时数据，接受大众监督。",
                address: "http://localhost:7848/api/rpc",
                image: "https://placeimg.com/100/100/any",
            },
        ];
        let endpointUrl = `${this.baseUrl}/database.json`;

        return this.http.get(endpointUrl)
            .map((response: Response) => response.json())
            .catch(error => Observable.of(dblist));
    }

    getAlertConfigList(dbid: string): Observable<Array<AlertConfiguration>> {
        var alertList = this.localStoreManager.getData(ChainDbService.DBKEY_CHAIN_DB_ALERT_CONFIGURATIONS) as Array<AlertConfiguration> || [];
        var dblist = alertList.filter(_ => _.dbid == dbid);

        return Observable.of(dblist);
    }

    addAlertConfig(config: AlertConfiguration): void {
        var alertList = this.localStoreManager.getData(ChainDbService.DBKEY_CHAIN_DB_ALERT_CONFIGURATIONS) as Array<AlertConfiguration> || [];
        alertList.push(config);
        this.localStoreManager.savePermanentData(alertList, ChainDbService.DBKEY_CHAIN_DB_ALERT_CONFIGURATIONS);
    }

    removeAlertConfig(config: AlertConfiguration): void {
        var alertList = this.localStoreManager.getData(ChainDbService.DBKEY_CHAIN_DB_ALERT_CONFIGURATIONS) as Array<AlertConfiguration> || [];
        var idx = alertList
            .findIndex(_ => _.type == config.type
                && _.dbid == config.dbid
                && _.tableName == config.tableName
                && _.columnName == config.columnName
                && _.primaryKeyValue == config.primaryKeyValue
            );
        alertList.splice(idx, 1);
        this.localStoreManager.savePermanentData(alertList, ChainDbService.DBKEY_CHAIN_DB_ALERT_CONFIGURATIONS);
    }

    refreshAlerts(): Observable<boolean> {
        let alertList = this.localStoreManager.getData(ChainDbService.DBKEY_CHAIN_DB_ALERT_CONFIGURATIONS) as Array<AlertConfiguration> || [];
        let obsList = alertList
            //.filter(_ => _.type == "chain-fork")
            .map(_ => this.generateAlertNotification(_));
        //for (let i = 0; i < alertList.length; i++) {
        //    let alert = alertList[i];

        //    this.generateAlertNotification(alert);
        //}

        //console.log("obs list", obsList);
        return Observable.forkJoin(obsList)
            .map(_ => {
                console.log("write back", _);
                this.localStoreManager.savePermanentData(alertList, ChainDbService.DBKEY_CHAIN_DB_ALERT_CONFIGURATIONS);
                return true;
            });

    }

    private generateAlertNotification(alert: AlertConfiguration): Observable<any> {
        return this.getChainDb(alert.dbid)
            .map(db => {
                let result: Observable<any> = Observable.of({});

                if (alert.type == "chain-fork") {
                    // detect change if data exist
                    if (alert.data && alert.data.lastBlockId) {
                        result = result.concat(
                            this.getQueryChain(db, alert.data.lastBlockId)
                                .map(resp => {
                                    //console.log("detecting change", resp, alert.data);
                                    if (!(resp.Block && resp.Block.Hash == alert.data.lastBlockId && resp.Block.Height == alert.data.lastBlockHeight)) {
                                        this.notificationService.createNotification(`database [${db.id}]${db.name} fork detected`, alert);
                                    }
                                }));
                    }

                    // update data using fresh server data
                    result = result.concat(this.getChainDbStatus(db)
                        .map(sts => {
                            alert.data = { lastBlockHeight: sts.Tail.Height, lastBlockId: sts.Tail.Hash };
                            //console.log("update data", sts);
                        }));
                } else if (alert.type == "table-schema") {
                    let query = this.getChainDbTableNames(db)
                        .map((resp: ListTablesRpcResponse) => resp.Tables.filter(_ => _.Name == alert.tableName)[0]);
                    // detect change if data exist
                    if (alert.data && alert.data.lastTransactionId) {
                        query = query
                            .map(table => {
                                if (table.History.TransactionHash != alert.data.lastTransactionId) {
                                    this.notificationService.createNotification(`table [${alert.tableName}] schema changed from transaction [${alert.data.lastTransactionId}] to [${table.History.TransactionHash}]`, alert);
                                }
                                //console.log("generate noti.. from data", table);
                                return table;
                            });
                    }

                    // update data using fresh server data
                    query = query.map(table => {
                        //console.log("update data", table);
                        alert.data = { lastTransactionId: table.History.TransactionHash };
                        return table;
                    })
                    result = result.concat(query);
                } else if (alert.type == "table-data-modify") {
                    // TODO: consider once again how this function implemented
                } else if (alert.type == "column-data-modify") {
                    // TODO: consider once again if this type is needed
                } else if (alert.type == "cell-data-modify") {
                    let query = this.getQueryCell(db, alert.tableName, alert.primaryKeyValue, alert.columnName, [alert.columnName])
                        .map(_ => _.transactions.slice(-1)[0].Hash);
                    // detect change if data exist
                    if (alert.data && alert.data.lastTransactionId) {
                        query = query
                            .map(hash => {
                                if (hash != alert.data.lastTransactionId) {
                                    this.notificationService.createNotification(`cell [${alert.primaryKeyValue}-${alert.columnName}] of table [${alert.tableName}] has changed from transaction [${alert.data.lastTransactionId}] to [${hash}]`, alert);
                                }
                                return hash;
                            });
                    }

                    // update data using fresh server data
                    query = query.map(hash => {
                        alert.data = { lastTransactionId: hash };
                        return hash;
                    })
                    result = result.concat(query);
                }

                return result;
            })
            .concatAll();
    }

    addChainDb(db: ChainDb): Observable<boolean> {
        var dblist = this.localStoreManager.getData(ChainDbService.DBKEY_CHAIN_DB_DATA) as Array<ChainDb>;
        dblist.push(db);
        this.localStoreManager.savePermanentData(dblist, ChainDbService.DBKEY_CHAIN_DB_DATA);

        return Observable.of(true);
    }

    getChainDbStatus(db: ChainDb): Observable<StatusRpcResponse> {
        return this.rpcCall(db.address, "Status", []);
    }

    getChainDb(dbid: string): Observable<ChainDb> {
        var dblist = this.localStoreManager.getData(ChainDbService.DBKEY_CHAIN_DB_DATA) as Array<ChainDb>;
        return Observable.of(dblist.find(_ => _.id == dbid));
    }

    getChainDbTableNames(db: ChainDb): Observable<ListTablesRpcResponse> {
        return this.rpcCall(db.address, "ListTables", []);
    }

    getChainDbTable(db: ChainDb, tableName: string): Observable<QueryTableResponse> {
        return this.rpcCall(db.address, "QueryData", [tableName, 0, 100]).
            map((_: QueryDataRpcResponse) => {
                let dataHist = _.DataHistories;
                let colHist = _.HeaderHistories;
                let pkname = _.PrimaryKeyName;

                let columns: Array<ColumnDef> = [];
                let headers = _.Headers;
                let pkidx = headers.findIndex(_ => _ == pkname);
                let colCount = headers.length;
                for (let i = 0; i < colCount; i++) {
                    let hist = colHist[i];
                    columns.push({
                        name: headers[i],
                        tran: hist.TransactionHash,
                        history: hist.HistoryLength,
                    });
                }

                let rows: Array<RowDef> = [];
                let data = _.Data;
                let rowCount = data.length / colCount;
                for (let i = 0; i < rowCount; i++) {
                    let row: RowDef = [];
                    for (let j = 0; j < colCount; j++) {
                        let hist = dataHist[i * colCount + j];
                        let pkval = data[i * colCount + pkidx];
                        row.push({
                            name: headers[j],
                            pkval: pkval,
                            data: data[i * colCount + j],
                            tran: hist.TransactionHash,
                            history: hist.HistoryLength,
                        });
                    }
                    rows.push(row);
                }

                return {
                    data: {
                        rows: rows,
                        columns: columns,
                        pkname: pkname,
                        dbid: db.id,
                        tableName: tableName,
                    }
                }
            });
    }

    getQueryChain(db: ChainDb, mixId: string): Observable<QueryChainRpcResponse> {
        return this.rpcCall(db.address, "QueryChain", [mixId]);
    }

    getQueryCell(db: ChainDb, tableName: string, primaryKeyValue: string, columnName: string, columns: string[]): Observable<QueryCellResponse> {
        columns = columns || [];
        return this.rpcCall(db.address, "QueryCell", [tableName, primaryKeyValue, columnName, ...columns])
            .map((_: QueryCellRpcResponse) => {
                let row: RowDef = [];
                let headers = _.Headers;
                let data = _.Row;
                let datahist = _.RowHistories;
                let pkname = _.PrimaryKeyName;
                let pkidx = headers.findIndex(_ => _ == pkname);
                let pkval = data[pkidx];
                let colCount = headers.length;
                for (let i = 0; i < colCount; i++) {
                    let hist = datahist[i];
                    row.push({
                        name: headers[i],
                        pkval: pkval,
                        data: data[i],
                        tran: hist.TransactionHash,
                        history: hist.HistoryLength,
                    });
                }
                let rows = [row];
                let columns = row.map(r => ({ name: r.name, tran: null, history: null }));

                let transactions = _.Transactions
                    .map(_ => new Transaction({ Hash: _ }));
                return {
                    data: {
                        rows: rows,
                        columns: columns,
                        pkname: pkname,
                        dbid: db.id,
                        tableName: tableName,
                    },
                    transactions: transactions,
                }
            });
    }

    createDataTransaction(db: ChainDb, privateKey: string, actions: Array<DataAction>): Observable<CreateTransactionRpcResponse> {
        let pubKey = this.cryptoService.getPublicKey(privateKey);
        let initiator = this.cryptoService.getAddress(pubKey);
        //let baseContent = `${initiator}|${Actions?.Select(_ => _.ToString()) ?? new string[] { })}";
        //protected internal override string HashContent => $"{this.UnlockScripts?.ToString()}|{BaseHashContent}";

        let signature = this.cryptoService.sign("test", privateKey);
        let sigarr = new Uint8Array(signature.r.length + signature.s.length);
        sigarr.set(signature.r);
        sigarr.set(signature.s, signature.r.length);
        let sig = this.cryptoService.to_b58(sigarr);
        let as = actions.map(_ => JSON.stringify(_));
        console.log("pubKey: ", pubKey);
        console.log("initiator: ", initiator);
        console.log("sig: ", sig);
        return this.rpcCall(db.address, "CreateDataTransaction", [initiator, sig, ...as]);
    }

    readonly errorCodes = {
        '-32700': 'JSON-RPC server reported a parse error in JSON request',
        '-32600': 'JSON-RPC server reported an invalid request',
        '-32601': 'Method not found',
        '-32602': 'Invalid parameters',
        '-32603': 'Internal error'
    };

    rpcCall(url: string, method: ChainDbRpcMethod, params): Observable<any> {
        let jsonParams = {
            jsonrpc: '2.0',
            id: 1,//(new Date).getTime(),
            method: method,
            params: params
        };
        let requestString = JSON.stringify(jsonParams);
        return this.http.post(url, requestString)
            .map((response: Response) => {
                console.debug(response);
                let decodedResponse = response.json();
                if (decodedResponse.error) {
                    let errorMessage = this.errorCodes[decodedResponse.error.code];
                    errorMessage += " " + decodedResponse.error.message;
                    throw new Error(errorMessage);
                }
                return decodedResponse.result;
            })
            .catch(error => this.handleError(error, () => this.rpcCall(url, method, params)));
    }

}
