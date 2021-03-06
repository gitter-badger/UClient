import { Injectable, Injector } from '@angular/core';
import { Observable } from "rxjs/Observable";
import 'rxjs/add/observable/of';
import { ConfigurationService } from "./configuration.service";
import { EndpointFactory } from "./endpoint-factory.service";
import { Http, Headers, Response, RequestOptions } from "@angular/http";
import { Router } from "@angular/router";
import { Pager } from "../models/pager.model";

@Injectable()
export class UiTextService extends EndpointFactory {

    private readonly _baseUrl: string = "";
    get baseUrl() { return this.configurations.baseUrl + this._baseUrl; }

    constructor(http: Http, configurations: ConfigurationService, injector: Injector) {
        super(http, configurations, injector);
    }

    private cacheUrlContent: { [index: string]: Observable<Response> } = {};

    private getUrlContentEndpoint(url: string, forceUpdate?: boolean): Observable<Response> {
        let endpointUrl = `${this.baseUrl}${url}`;

        let key = url;
        if (forceUpdate) this.cacheUrlContent[key] = null;
        if (!this.cacheUrlContent[key]) {
            this.cacheUrlContent[key] = this.http.get(endpointUrl)//, this.getAuthHeader())
                .map((response: Response) => response)
                .publishReplay(1)
                .refCount()
                .catch(error => this.handleError(error, () => this.getUrlContentEndpoint(url, forceUpdate)));
        }
        return this.cacheUrlContent[key];
    }

    getUrlContent(url:string, forceUpdate?: boolean): Observable<string> {
        return this.getUrlContentEndpoint(url, forceUpdate)
            .map((response: Response) => response.text());
    }

    getArticleList(pager?: Pager): Observable<any> {
        let endpointUrl = `${this.baseUrl}/articles.json`;

        return this.http.get(endpointUrl)
            .map((response: Response) => response.json())
    }
}
