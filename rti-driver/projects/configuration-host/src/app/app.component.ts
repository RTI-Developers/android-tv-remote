import { Device } from './device';
import { WebsocketService } from './websocket.service';
import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, NavigationEnd, Router } from '@angular/router';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent implements OnInit {
  devices: Device[] = [];
  showPairing = false;
  showWelcome = false;

  constructor(
    private activatedRoute: ActivatedRoute,
    private router: Router,
    private webSocketService: WebsocketService
  ) { }

  ngOnInit() {
    this.router.events.subscribe(event => {
      if (event instanceof NavigationEnd) {
        this.showPairing = this.activatedRoute?.firstChild?.snapshot.data.showPairing !== false ?? false;
        this.showWelcome = this.activatedRoute?.firstChild?.snapshot.data.showWelcome !== false ?? true;
      }
    });

    this.webSocketService.DataStream.subscribe(data => {
      this.devices = data
    });
  };
}
