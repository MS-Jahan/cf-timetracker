import 'dart:io';

import 'package:flutter/widgets.dart';
import 'package:tray_manager/tray_manager.dart';
import 'package:window_manager/window_manager.dart';

class DesktopTrayController with TrayListener {
  VoidCallback? _onShow;
  VoidCallback? _onQuit;
  bool _enabled = false;

  Future<void> initialize(VoidCallback onShow, VoidCallback onQuit) async {
    if (!(Platform.isWindows || Platform.isLinux || Platform.isMacOS)) return;
    _onShow = onShow;
    _onQuit = onQuit;
    _enabled = true;
    trayManager.addListener(this);
    await windowManager.ensureInitialized();
    await windowManager.setMinimumSize(const Size(360, 260));
    try {
      if (Platform.isWindows) {
        await trayManager.setIcon('windows/runner/resources/app_icon.ico');
      }
      await trayManager.setToolTip('Timetracker');
      await trayManager.setContextMenu(
        Menu(
          items: [
            MenuItem(key: 'show', label: 'Show Timetracker'),
            MenuItem.separator(),
            MenuItem(key: 'quit', label: 'Quit'),
          ],
        ),
      );
    } catch (_) {
      // A missing host tray is non-fatal; the normal Flutter window remains usable.
    }
  }

  @override
  void onTrayIconMouseDown() => _onShow?.call();

  @override
  void onTrayIconRightMouseDown() => trayManager.popUpContextMenu();

  @override
  void onTrayMenuItemClick(MenuItem menuItem) {
    if (menuItem.key == 'show') _onShow?.call();
    if (menuItem.key == 'quit') _onQuit?.call();
  }

  Future<void> showWindow() => windowManager.show();
  Future<void> closeWindow() => windowManager.close();
  Future<void> setMiniWindow(bool mini, bool alwaysOnTop) async {
    await windowManager.setSize(
      mini ? const Size(420, 320) : const Size(1000, 760),
    );
    await windowManager.setAlwaysOnTop(mini || alwaysOnTop);
  }

  Future<void> dispose() async {
    if (!_enabled) return;
    trayManager.removeListener(this);
    await trayManager.destroy();
    _enabled = false;
  }
}
