import { Device } from '../device';
import { WebsocketService } from '../websocket.service';
import { Component, OnInit } from '@angular/core';

@Component({
  selector: 'app-navigation',
  templateUrl: './navigation.component.html',
  styleUrls: ['./navigation.component.css']
})
export class NavigationComponent implements OnInit {

  devices: Device[] = [];

  constructor(
    private webSocketService: WebsocketService
  ) { }

  ngOnInit(): void {
    this.webSocketService.DataStream.subscribe(data => {
      this.devices = data
    });
  };
}
