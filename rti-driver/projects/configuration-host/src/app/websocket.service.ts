import { Device } from './device';
import { environment } from '../environments/environment';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { publishReplay, refCount } from 'rxjs/operators';
import { webSocket, WebSocketSubject } from 'rxjs/webSocket';

@Injectable({
  providedIn: 'root'
})
export class WebsocketService {
  public DataStream: Observable<Device[]>;

  constructor() {
    const ws = webSocket<Device[]>('ws://' + environment.host);
    this.DataStream = ws.asObservable().pipe(publishReplay(1), refCount());
  }
}
