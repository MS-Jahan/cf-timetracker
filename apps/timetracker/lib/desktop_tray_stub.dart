import 'package:flutter/widgets.dart';

class DesktopTrayController {
  Future<void> initialize(VoidCallback onShow, VoidCallback onQuit) async {}
  Future<void> showWindow() async {}
  Future<void> closeWindow() async {}
  Future<void> setMiniWindow(bool mini, bool alwaysOnTop) async {}
  Future<void> dispose() async {}
}
