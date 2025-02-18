import { HttpClient } from '@angular/common/http';
import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { combineLatest, Observable } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { ConfigureCompanionAppRequest } from '../configureCompanionAppRequest';
import { Device } from '../device';
import { InitiatePairingRequest } from '../initiatePairingRequest';
import { InstallCompanionAppRequest } from '../installCompanionAppRequest';
import { SendAnswerRequest } from '../sendAnswerRequest';
import { WebsocketService } from '../websocket.service';

@Component({
  selector: 'app-pairing',
  templateUrl: './pairing.component.html',
  styleUrls: ['./pairing.component.css']
})
export class PairingComponent implements OnInit {

  device?: Device;
  isInitiatingPairing: boolean = false;
  isSendingAnswer: boolean = false;

  constructor(
    private httpClient: HttpClient,
    private route: ActivatedRoute,
    private webSocketService: WebsocketService
  ) { }

  get isConfigured(): boolean {
    return (this.device?.controlState == 'Configured');
  }

  get isProcessing(): boolean {
    return (this.isInitiatingPairing || this.isSendingAnswer);
  }

  get pairingText(): string {
    return (this.isConfigured ? 'Re-Pair' : 'Initiate Pairing');
  }

  get showCompanionAppOptions(): boolean {
    return this.isConfigured;
  }

  get showConnectionFailedMessage(): boolean {
    return (this.device!.controlState == "Failed");
  }
  
  get showInitiatePairing(): boolean {
    return (
       !this.isInitiatingPairing &&
       this.device?.pairingState == "" &&
       this.device?.controlState != 'Failed'
    );
  }

  get showSendAnswer(): boolean {
    return (!this.isSendingAnswer && this.device?.pairingState == "WaitingForAnswer");
  }

  get stateText(): string{
    if (!this.device) { return 'Unknown'; }

    if (this.device.pairingState) {
      return 'Pairing: ' + this.device.pairingState;
    } else {
      if (this.device.controlState == 'Connected' || this.device.controlState == 'Disconnected') {
        return 'Unpaired'
      }

      return this.device.controlState;
    }
  }

  ngOnInit(): void {
    combineLatest([
        this.route.params.pipe(map(params => parseInt(params['index']))),
        this.webSocketService.DataStream
    ]).subscribe(
      ([index, devices]) =>
      {
        this.device = devices.filter(device => device.index == index)[0];

        switch (this.device.pairingState) {
          case "WaitingForAnswer":
          case "SendingAnswer":
            this.isInitiatingPairing = false;
            break;
          case "Successful":
          case "Failed":
            this.isInitiatingPairing = false;
            this.isSendingAnswer = false;
            break;
        }
        
        console.log('device update: ');
        console.log(this.device);
      }
    );
  }

  configureCompanionApp() {
    this.httpClient.post<ConfigureCompanionAppRequest>(
      'http://' + environment.host,
      new ConfigureCompanionAppRequest(this.device!.index)
    )
    .pipe(catchError(error => this.handleError(error)))
    .subscribe();
  }

  initiatePairing() {
    this.isInitiatingPairing = true;
    
    this.httpClient.post<InitiatePairingRequest>(
      'http://' + environment.host,
      new InitiatePairingRequest(this.device!.index)
    )
    .pipe(
      catchError(error => this.handleError(error)))
    .subscribe();
  }

  installCompanionApp() {
    this.httpClient.post<InstallCompanionAppRequest>(
      'http://' + environment.host,
      new InstallCompanionAppRequest(this.device!.index)
    )
    .pipe(catchError(error => this.handleError(error)))
    .subscribe();
  }

  sendAnswer(answer: string) { 
    this.isSendingAnswer = true;
    
    this.httpClient.post<SendAnswerRequest>(
      'http://' + environment.host,
      new SendAnswerRequest(this.device!.index, answer)  
    )
    .pipe(catchError(error => this.handleError(error)))
    .subscribe();
  }

  private handleError(error: any): any {
    throw new Error(error);
  }
}
