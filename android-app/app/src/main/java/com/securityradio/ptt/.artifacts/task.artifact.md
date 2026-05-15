# task.artifact.md

- [/] Implement background persistence and foreground service
	- [ ] Create `RadioForegroundService`
	- [ ] Declare service and permissions in `AndroidManifest.xml`
	- [ ] Implement `BootReceiver` for auto-start
	- [ ] Handle battery optimization exclusion request
- [ ] Implement theme mirroring settings
	- [ ] Update `RadioUiState` and `RadioUiEvent`
	- [ ] Update `RadioViewModel` and `RadioShell` logic
	- [ ] Add theme selection to settings menu
- [ ] Implement auto-foregrounding on PTT/RX
	- [ ] Research and implement `showWhenLocked` / `turnScreenOn` / `Activity` flag logic
	- [ ] Trigger foregrounding from `HardwareButtonRelay` or `RadioViewModel`
- [ ] Verification
	- [ ] Verify background persistence
	- [ ] Verify auto-start on boot
	- [ ] Verify theme mirroring
	- [ ] Verify auto-foregrounding
