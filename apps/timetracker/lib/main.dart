import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:record/record.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:url_launcher/url_launcher.dart';

import 'desktop_tray.dart';

const apiBaseUrl = String.fromEnvironment(
  'API_BASE_URL',
  defaultValue: 'http://127.0.0.1:8787',
);

void main() => runApp(const TimeTrackerApp());

class TimeTrackerApp extends StatefulWidget {
  const TimeTrackerApp({super.key});

  @override
  State<TimeTrackerApp> createState() => _TimeTrackerAppState();
}

class _TimeTrackerAppState extends State<TimeTrackerApp> {
  ThemeMode themeMode = ThemeMode.system;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Timetracker',
      debugShowCheckedModeBanner: false,
      themeMode: themeMode,
      theme: ThemeData(
        colorSchemeSeed: Colors.red,
        brightness: Brightness.light,
        useMaterial3: true,
      ),
      darkTheme: ThemeData(
        colorSchemeSeed: Colors.red,
        brightness: Brightness.dark,
        useMaterial3: true,
      ),
      home: TrackerShell(
        themeMode: themeMode,
        onThemeChanged: (value) => setState(() => themeMode = value),
      ),
    );
  }
}

class TrackerShell extends StatefulWidget {
  const TrackerShell({
    required this.themeMode,
    required this.onThemeChanged,
    super.key,
  });

  final ThemeMode themeMode;
  final ValueChanged<ThemeMode> onThemeChanged;

  @override
  State<TrackerShell> createState() => _TrackerShellState();
}

class _TrackerShellState extends State<TrackerShell> {
  final tray = DesktopTrayController();
  final client = TrackerApi(apiBaseUrl, String.fromEnvironment('APP_TOKEN'));
  Bootstrap? bootstrap;
  String configuredApiUrl = apiBaseUrl;
  String configuredToken = String.fromEnvironment('APP_TOKEN');
  String? error;
  bool loading = true;
  bool busy = false;
  bool miniWindow = false;
  bool alwaysOnTop = false;
  int section = 0;
  String notice = '';

  @override
  void initState() {
    super.initState();
    loadConfig();
    tray.initialize(() => tray.showWindow(), () => tray.closeWindow());
  }

  @override
  void dispose() {
    tray.dispose();
    super.dispose();
  }

  Future<void> loadConfig() async {
    final prefs = await SharedPreferences.getInstance();
    configuredApiUrl = prefs.getString('api_url') ?? apiBaseUrl;
    configuredToken = prefs.getString('app_token') ?? configuredToken;
    client.configure(configuredApiUrl, configuredToken);
    await load();
  }

  Future<void> saveConfig(String url, String token) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('api_url', url.trim());
    await prefs.setString('app_token', token.trim());
    client.configure(url.trim(), token.trim());
    if (mounted) {
      setState(() {
        configuredApiUrl = url.trim();
        configuredToken = token.trim();
      });
      await load();
      setState(() => notice = 'Connection settings saved.');
    }
  }

  Future<void> load() async {
    setState(() {
      loading = true;
      error = null;
    });
    try {
      final result = await client.bootstrap();
      if (!mounted) return;
      setState(() => bootstrap = result);
    } catch (exception) {
      if (!mounted) return;
      setState(() => error = exception.toString());
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  Future<void> start(TimerDraft draft) async {
    setState(() {
      busy = true;
      notice = '';
    });
    try {
      await client.start(draft);
      await load();
      if (mounted) setState(() => notice = 'Timer started.');
    } catch (exception) {
      if (mounted) setState(() => error = exception.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> stop() async {
    setState(() {
      busy = true;
      notice = '';
    });
    try {
      await client.stop();
      await load();
      if (mounted) setState(() => notice = 'Entry saved.');
    } catch (exception) {
      if (mounted) setState(() => error = exception.toString());
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final wide = MediaQuery.sizeOf(context).width >= 850;
    final titles = ['Dashboard', 'Time entries', 'Settings'];
    final body = loading
        ? const Center(child: CircularProgressIndicator())
        : error != null
        ? ErrorState(message: error!, onRetry: load)
        : section == 0
        ? DashboardView(
            bootstrap: bootstrap!,
            onOpenTracker: () => setState(() => section = 1),
          )
        : section == 1
        ? TrackerView(
            bootstrap: bootstrap!,
            client: client,
            busy: busy,
            onStart: start,
            onStop: stop,
          )
        : SettingsView(
            bootstrap: bootstrap!,
            themeMode: widget.themeMode,
            onThemeChanged: widget.onThemeChanged,
            onRefresh: load,
            apiUrl: configuredApiUrl,
            appToken: configuredToken,
            onSaveConfig: saveConfig,
          );

    return Scaffold(
      appBar: AppBar(
        title: Text(titles[section]),
        actions: [
          if (wide && bootstrap?.activeTimer != null)
            IconButton(
              tooltip: 'Mini timer window',
              onPressed: () async {
                setState(() => miniWindow = !miniWindow);
                await tray.setMiniWindow(miniWindow, alwaysOnTop);
              },
              icon: Icon(
                miniWindow ? Icons.fullscreen : Icons.picture_in_picture_alt,
              ),
            ),
          if (wide && miniWindow)
            IconButton(
              tooltip: 'Always on top',
              onPressed: () async {
                setState(() => alwaysOnTop = !alwaysOnTop);
                await tray.setMiniWindow(miniWindow, alwaysOnTop);
              },
              icon: Icon(
                alwaysOnTop ? Icons.push_pin : Icons.push_pin_outlined,
              ),
            ),
          if (bootstrap?.activeTimer != null)
            Padding(
              padding: const EdgeInsets.only(right: 12),
              child: TimerBadge(timer: bootstrap!.activeTimer!),
            ),
        ],
      ),
      drawer: wide
          ? null
          : NavigationDrawer(
              selectedIndex: section,
              onDestinationSelected: (value) {
                Navigator.pop(context);
                setState(() => section = value);
              },
              children: const [
                Padding(
                  padding: EdgeInsets.fromLTRB(28, 16, 16, 8),
                  child: Text('Timetracker'),
                ),
                NavigationDrawerDestination(
                  icon: Icon(Icons.dashboard_outlined),
                  selectedIcon: Icon(Icons.dashboard),
                  label: Text('Dashboard'),
                ),
                NavigationDrawerDestination(
                  icon: Icon(Icons.timer_outlined),
                  selectedIcon: Icon(Icons.timer),
                  label: Text('Time entries'),
                ),
                NavigationDrawerDestination(
                  icon: Icon(Icons.settings_outlined),
                  selectedIcon: Icon(Icons.settings),
                  label: Text('Settings'),
                ),
              ],
            ),
      body: Row(
        children: [
          if (wide)
            NavigationRail(
              selectedIndex: section,
              onDestinationSelected: (value) => setState(() => section = value),
              labelType: NavigationRailLabelType.all,
              destinations: const [
                NavigationRailDestination(
                  icon: Icon(Icons.dashboard_outlined),
                  selectedIcon: Icon(Icons.dashboard),
                  label: Text('Dashboard'),
                ),
                NavigationRailDestination(
                  icon: Icon(Icons.timer_outlined),
                  selectedIcon: Icon(Icons.timer),
                  label: Text('Time entries'),
                ),
                NavigationRailDestination(
                  icon: Icon(Icons.settings_outlined),
                  selectedIcon: Icon(Icons.settings),
                  label: Text('Settings'),
                ),
              ],
            ),
          Expanded(
            child: Column(
              children: [
                if (notice.isNotEmpty)
                  MaterialBanner(
                    content: Text(notice),
                    actions: [
                      TextButton(
                        onPressed: () => setState(() => notice = ''),
                        child: const Text('Dismiss'),
                      ),
                    ],
                  ),
                Expanded(
                  child: Center(
                    child: ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 1200),
                      child: Padding(
                        padding: const EdgeInsets.all(24),
                        child: body,
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
      bottomNavigationBar: wide
          ? null
          : NavigationBar(
              selectedIndex: section,
              onDestinationSelected: (value) => setState(() => section = value),
              destinations: const [
                NavigationDestination(
                  icon: Icon(Icons.dashboard_outlined),
                  selectedIcon: Icon(Icons.dashboard),
                  label: 'Dashboard',
                ),
                NavigationDestination(
                  icon: Icon(Icons.timer_outlined),
                  selectedIcon: Icon(Icons.timer),
                  label: 'Time',
                ),
                NavigationDestination(
                  icon: Icon(Icons.settings_outlined),
                  selectedIcon: Icon(Icons.settings),
                  label: 'Settings',
                ),
              ],
            ),
    );
  }
}

class TrackerView extends StatefulWidget {
  const TrackerView({
    required this.bootstrap,
    required this.client,
    required this.busy,
    required this.onStart,
    required this.onStop,
    super.key,
  });
  final Bootstrap bootstrap;
  final TrackerApi client;
  final bool busy;
  final Future<void> Function(TimerDraft) onStart;
  final Future<void> Function() onStop;

  @override
  State<TrackerView> createState() => _TrackerViewState();
}

class _TrackerViewState extends State<TrackerView> {
  String? customerId;
  String? projectId;
  String? activityId;
  String period = 'all';
  DateTimeRange? customRange;
  List<Entry> visibleEntries = [];
  bool loadingEntries = false;
  final note = TextEditingController();
  final tags = TextEditingController();
  final recorder = AudioRecorder();
  bool recording = false;

  @override
  void initState() {
    super.initState();
    visibleEntries = widget.bootstrap.entries;
  }

  Future<void> applyPeriod(String value) async {
    setState(() {
      period = value;
      loadingEntries = true;
    });
    final now = DateTime.now().millisecondsSinceEpoch;
    if (value == 'custom') {
      customRange = await showDateRangePicker(
        context: context,
        firstDate: DateTime(2020),
        lastDate: DateTime.now().add(const Duration(days: 1)),
        initialDateRange: customRange,
      );
      if (customRange == null) {
        if (mounted) {
          setState(() {
            loadingEntries = false;
            period = 'all';
          });
        }
        return;
      }
    }
    final from = switch (value) {
      'week' => now - 7 * 24 * 60 * 60 * 1000,
      'month' => now - 30 * 24 * 60 * 60 * 1000,
      'twoMonths' => now - 60 * 24 * 60 * 60 * 1000,
      'custom' => customRange!.start.millisecondsSinceEpoch,
      _ => null,
    };
    final rangeEnd = value == 'custom'
        ? customRange!.end.add(const Duration(days: 1)).millisecondsSinceEpoch
        : now;
    try {
      final page = await widget.client.entries(
        fromMs: from,
        toMs: from == null ? null : rangeEnd,
      );
      if (mounted) setState(() => visibleEntries = page.entries);
    } finally {
      if (mounted) setState(() => loadingEntries = false);
    }
  }

  Future<void> toggleVoice() async {
    if (recording) {
      final path = await recorder.stop();
      setState(() => recording = false);
      if (path == null) return;
      try {
        final audio = base64Encode(await File(path).readAsBytes());
        final result = await widget.client.parseVoice(audio, 'audio/mp4');
        final draft = result['draft'] as Map<String, dynamic>?;
        if (draft?['description'] is String && mounted) {
          note.text = draft!['description'] as String;
        }
        if (draft?['tags'] is List && mounted) {
          tags.text = (draft!['tags'] as List).join(', ');
        }
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Voice draft added. Review it before starting.'),
            ),
          );
        }
      } catch (exception) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('Voice draft failed: $exception')),
          );
        }
      }
      return;
    }
    if (!await recorder.hasPermission()) {
      return;
    }
    await recorder.start(const RecordConfig(), path: 'timetracker-voice.m4a');
    setState(() => recording = true);
  }

  @override
  void dispose() {
    recorder.dispose();
    note.dispose();
    tags.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final data = widget.bootstrap;
    final hasSetup =
        data.customers.isNotEmpty &&
        data.projects.isNotEmpty &&
        data.activities.isNotEmpty;
    if (!hasSetup) return const EmptySetup();
    final projects = data.projects
        .where((item) => customerId == null || item.customerId == customerId)
        .toList();
    customerId ??= data.customers.first.id;
    projectId ??= projects.first.id;
    activityId ??= data.activities.first.id;
    final running = data.activeTimer != null;

    return ListView(
      children: [
        Text('Start a timer', style: Theme.of(context).textTheme.headlineSmall),
        const SizedBox(height: 6),
        Text(
          running
              ? 'Your current timer is locked. Stop it from the top bar when the work is done.'
              : 'Choose a client, project, and activity, then start the clock.',
          style: Theme.of(context).textTheme.bodyMedium,
        ),
        const SizedBox(height: 20),
        Wrap(
          spacing: 12,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            const Text('Show'),
            DropdownButton<String>(
              value: period,
              items: const [
                DropdownMenuItem(value: 'all', child: Text('All entries')),
                DropdownMenuItem(value: 'week', child: Text('Last week')),
                DropdownMenuItem(value: 'month', child: Text('Last month')),
                DropdownMenuItem(
                  value: 'twoMonths',
                  child: Text('Last two months'),
                ),
                DropdownMenuItem(value: 'custom', child: Text('Custom range')),
              ],
              onChanged: loadingEntries
                  ? null
                  : (value) => value == null ? null : applyPeriod(value),
            ),
            if (loadingEntries)
              const SizedBox(
                width: 16,
                height: 16,
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
          ],
        ),
        const SizedBox(height: 12),
        if (!running)
          Wrap(
            spacing: 16,
            runSpacing: 16,
            children: [
              DropdownButton<String>(
                value: customerId,
                hint: const Text('Client'),
                items: data.customers
                    .map(
                      (item) => DropdownMenuItem(
                        value: item.id,
                        child: Text(item.name),
                      ),
                    )
                    .toList(),
                onChanged: (value) => setState(() {
                  customerId = value;
                  projectId = null;
                }),
              ),
              DropdownButton<String>(
                value: projects.any((item) => item.id == projectId)
                    ? projectId
                    : null,
                hint: const Text('Project'),
                items: projects
                    .map(
                      (item) => DropdownMenuItem(
                        value: item.id,
                        child: Text(item.name),
                      ),
                    )
                    .toList(),
                onChanged: (value) => setState(() => projectId = value),
              ),
              DropdownButton<String>(
                value: activityId,
                hint: const Text('Activity'),
                items: data.activities
                    .map(
                      (item) => DropdownMenuItem(
                        value: item.id,
                        child: Text(item.name),
                      ),
                    )
                    .toList(),
                onChanged: (value) => setState(() => activityId = value),
              ),
              SizedBox(
                width: 260,
                child: TextField(
                  controller: note,
                  decoration: const InputDecoration(
                    labelText: 'Note',
                    hintText: 'Landing page build',
                  ),
                ),
              ),
              SizedBox(
                width: 180,
                child: TextField(
                  controller: tags,
                  decoration: const InputDecoration(
                    labelText: 'Tags',
                    hintText: 'design, qa',
                  ),
                ),
              ),
              OutlinedButton.icon(
                onPressed: toggleVoice,
                icon: Icon(recording ? Icons.stop : Icons.mic),
                label: Text(recording ? 'Stop voice' : 'Voice draft'),
              ),
              FilledButton.icon(
                onPressed:
                    widget.busy ||
                        customerId == null ||
                        projectId == null ||
                        activityId == null
                    ? null
                    : () => widget.onStart(
                        TimerDraft(
                          customerId!,
                          projectId!,
                          activityId!,
                          note.text,
                          tags.text,
                        ),
                      ),
                icon: const Icon(Icons.play_arrow),
                label: Text(widget.busy ? 'Starting…' : 'Start timer'),
              ),
            ],
          )
        else
          Card(
            child: ListTile(
              leading: const Icon(Icons.radio_button_on, color: Colors.red),
              title: Text(
                data.activeTimer!.description.isEmpty
                    ? 'Timer running'
                    : data.activeTimer!.description,
              ),
              subtitle: Text(
                '${data.activeTimer!.customerName} · ${data.activeTimer!.projectName}',
              ),
              trailing: FilledButton.icon(
                onPressed: widget.busy ? null : widget.onStop,
                icon: const Icon(Icons.stop),
                label: Text(widget.busy ? 'Stopping…' : 'Stop'),
              ),
            ),
          ),
        const SizedBox(height: 32),
        Text('Recent entries', style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: 8),
        if (visibleEntries.isEmpty)
          const EmptyEntries()
        else
          ...visibleEntries.map(
            (entry) => Card(
              margin: const EdgeInsets.only(bottom: 8),
              child: ListTile(
                title: Text(
                  entry.description.isEmpty
                      ? entry.activityName
                      : entry.description,
                ),
                subtitle: Text(
                  '${entry.customerName} · ${entry.projectName} · ${entry.activityName}',
                ),
                trailing: Text(formatDuration(entry.durationSeconds)),
              ),
            ),
          ),
      ],
    );
  }
}

class DashboardView extends StatelessWidget {
  const DashboardView({
    required this.bootstrap,
    required this.onOpenTracker,
    super.key,
  });
  final Bootstrap bootstrap;
  final VoidCallback onOpenTracker;

  @override
  Widget build(BuildContext context) {
    final seconds = bootstrap.entries.fold<int>(
      0,
      (sum, entry) => sum + entry.durationSeconds,
    );
    return ListView(
      children: [
        Text(
          'Your work at a glance',
          style: Theme.of(context).textTheme.headlineSmall,
        ),
        const SizedBox(height: 8),
        Text(
          'Start recording time to build your report.',
          style: Theme.of(context).textTheme.bodyMedium,
        ),
        const SizedBox(height: 24),
        Wrap(
          spacing: 16,
          runSpacing: 16,
          children: [
            StatCard(
              label: 'Recent hours',
              value: (seconds / 3600).toStringAsFixed(2),
            ),
            StatCard(
              label: 'Closed entries',
              value: '${bootstrap.entries.length}',
            ),
            StatCard(
              label: 'Active clients',
              value: '${bootstrap.customers.length}',
            ),
          ],
        ),
        const SizedBox(height: 32),
        FilledButton.icon(
          onPressed: onOpenTracker,
          icon: const Icon(Icons.timer),
          label: const Text('Record time'),
        ),
      ],
    );
  }
}

class SettingsView extends StatefulWidget {
  const SettingsView({
    required this.bootstrap,
    required this.themeMode,
    required this.onThemeChanged,
    required this.onRefresh,
    required this.apiUrl,
    required this.appToken,
    required this.onSaveConfig,
    super.key,
  });

  final Bootstrap bootstrap;
  final ThemeMode themeMode;
  final ValueChanged<ThemeMode> onThemeChanged;
  final VoidCallback onRefresh;
  final String apiUrl;
  final String appToken;
  final Future<void> Function(String url, String token) onSaveConfig;

  @override
  State<SettingsView> createState() => _SettingsViewState();
}

class _SettingsViewState extends State<SettingsView> {
  late final TextEditingController url;
  late final TextEditingController token;
  bool saving = false;

  @override
  void initState() {
    super.initState();
    url = TextEditingController(text: widget.apiUrl);
    token = TextEditingController(text: widget.appToken);
  }

  @override
  void dispose() {
    url.dispose();
    token.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return ListView(
      children: [
        Text('Settings', style: Theme.of(context).textTheme.headlineSmall),
        const SizedBox(height: 8),
        Text(
          'Appearance and connection for this device.',
          style: Theme.of(context).textTheme.bodyMedium,
        ),
        const SizedBox(height: 24),
        Text('Theme', style: Theme.of(context).textTheme.titleMedium),
        Wrap(
          spacing: 8,
          children: [
            ChoiceChip(
              label: const Text('System'),
              selected: widget.themeMode == ThemeMode.system,
              onSelected: (_) => widget.onThemeChanged(ThemeMode.system),
            ),
            ChoiceChip(
              label: const Text('Light'),
              selected: widget.themeMode == ThemeMode.light,
              onSelected: (_) => widget.onThemeChanged(ThemeMode.light),
            ),
            ChoiceChip(
              label: const Text('Dark'),
              selected: widget.themeMode == ThemeMode.dark,
              onSelected: (_) => widget.onThemeChanged(ThemeMode.dark),
            ),
          ],
        ),
        const SizedBox(height: 24),
        TextField(
          controller: url,
          decoration: const InputDecoration(
            labelText: 'Worker/API URL',
            hintText: 'https://api.example.com',
          ),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: token,
          obscureText: true,
          decoration: const InputDecoration(
            labelText: 'App token (optional)',
            helperText:
                'Use the Worker APP_TOKEN for native clients; never use the Gemini key here.',
          ),
        ),
        const SizedBox(height: 12),
        Wrap(
          spacing: 12,
          children: [
            FilledButton.icon(
              onPressed: saving
                  ? null
                  : () async {
                      setState(() => saving = true);
                      try {
                        await widget.onSaveConfig(url.text, token.text);
                      } finally {
                        if (mounted) setState(() => saving = false);
                      }
                    },
              icon: const Icon(Icons.save),
              label: Text(saving ? 'Saving…' : 'Save connection'),
            ),
            OutlinedButton.icon(
              onPressed: widget.onRefresh,
              icon: const Icon(Icons.refresh),
              label: const Text('Check connection'),
            ),
            TextButton.icon(
              onPressed: () => launchUrl(Uri.parse(url.text)),
              icon: const Icon(Icons.open_in_new),
              label: const Text('Open web app'),
            ),
          ],
        ),
        const SizedBox(height: 12),
        ListTile(
          leading: const Icon(Icons.cloud_done),
          title: const Text('Worker API'),
          subtitle: Text(widget.apiUrl),
        ),
        const Divider(),
        ListTile(
          title: const Text('Workspace records'),
          subtitle: Text(
            '${widget.bootstrap.customers.length} clients · ${widget.bootstrap.projects.length} projects · ${widget.bootstrap.activities.length} activities',
          ),
        ),
      ],
    );
  }
}

class EmptySetup extends StatelessWidget {
  const EmptySetup({super.key});

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Set up your workspace first',
              style: Theme.of(context).textTheme.titleLarge,
            ),
            const SizedBox(height: 8),
            const Text(
              'Create a client, project, and activity in Settings before starting a timer.',
            ),
          ],
        ),
      ),
    );
  }
}

class EmptyEntries extends StatelessWidget {
  const EmptyEntries({super.key});

  @override
  Widget build(BuildContext context) {
    return const Card(
      child: Padding(
        padding: EdgeInsets.all(24),
        child: Text(
          'No time entries yet. Start a timer above and your history will appear here.',
        ),
      ),
    );
  }
}

class ErrorState extends StatelessWidget {
  const ErrorState({required this.message, required this.onRetry, super.key});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text('Could not reach the API'),
              const SizedBox(height: 8),
              Text(message, textAlign: TextAlign.center),
              const SizedBox(height: 16),
              FilledButton.icon(
                onPressed: onRetry,
                icon: const Icon(Icons.refresh),
                label: const Text('Try again'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class StatCard extends StatelessWidget {
  const StatCard({required this.label, required this.value, super.key});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 190,
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(18),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(label),
              const SizedBox(height: 8),
              Text(value, style: Theme.of(context).textTheme.headlineMedium),
            ],
          ),
        ),
      ),
    );
  }
}

class TimerBadge extends StatelessWidget {
  const TimerBadge({required this.timer, super.key});
  final Entry timer;
  @override
  Widget build(BuildContext context) => Chip(
    avatar: const Icon(Icons.circle, size: 10, color: Colors.red),
    label: Text('Running · ${timer.customerName}'),
  );
}

class TimerDraft {
  const TimerDraft(
    this.customerId,
    this.projectId,
    this.activityId,
    this.description,
    this.tags,
  );
  final String customerId;
  final String projectId;
  final String activityId;
  final String description;
  final String tags;
}

class TrackerApi {
  TrackerApi(this.baseUrl, [this.appToken = '']);
  String baseUrl;
  String appToken;

  void configure(String url, String token) {
    baseUrl = url.replaceFirst(RegExp(r'/$'), '');
    appToken = token;
  }

  Map<String, String> get headers => {
    'Content-Type': 'application/json',
    if (appToken.isNotEmpty) 'X-App-Token': appToken,
  };

  Future<Bootstrap> bootstrap() async {
    final response = await http.get(
      Uri.parse('$baseUrl/api/bootstrap'),
      headers: headers,
    );
    return _decode(response, Bootstrap.fromJson);
  }

  Future<void> start(TimerDraft draft) async {
    final response = await http.post(
      Uri.parse('$baseUrl/api/timer/start'),
      headers: headers,
      body: jsonEncode({
        'customerId': draft.customerId,
        'projectId': draft.projectId,
        'activityId': draft.activityId,
        'description': draft.description,
        'tags': draft.tags,
      }),
    );
    _decode(response, (_) => true);
  }

  Future<EntryPage> entries({int? fromMs, int? toMs}) async {
    final params = <String, String>{'limit': '50', 'offset': '0'};
    if (fromMs != null && toMs != null) {
      params['fromMs'] = '$fromMs';
      params['toMs'] = '$toMs';
    }
    final response = await http.get(
      Uri.parse('$baseUrl/api/entries').replace(queryParameters: params),
      headers: headers,
    );
    return _decode(response, EntryPage.fromJson);
  }

  Future<Map<String, dynamic>> parseVoice(
    String audioBase64,
    String mimeType,
  ) async {
    final response = await http.post(
      Uri.parse('$baseUrl/api/voice/parse'),
      headers: headers,
      body: jsonEncode({'audioBase64': audioBase64, 'mimeType': mimeType}),
    );
    return _decode(response, (body) => body);
  }

  Future<void> stop() async {
    final response = await http.post(
      Uri.parse('$baseUrl/api/timer/stop'),
      headers: headers,
    );
    _decode(response, (_) => true);
  }

  T _decode<T>(
    http.Response response,
    T Function(Map<String, dynamic>) parser,
  ) {
    final body = jsonDecode(response.body) as Map<String, dynamic>;
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception(
        body['error'] ?? 'Request failed (${response.statusCode})',
      );
    }
    return parser(body);
  }
}

class EntryPage {
  EntryPage({required this.entries, required this.total});
  final List<Entry> entries;
  final int total;

  factory EntryPage.fromJson(Map<String, dynamic> json) => EntryPage(
    entries: (json['entries'] as List? ?? [])
        .map((item) => Entry.fromJson(item))
        .toList(),
    total: (json['paging']?['total'] as num?)?.toInt() ?? 0,
  );
}

class Bootstrap {
  Bootstrap({
    required this.activeTimer,
    required this.entries,
    required this.customers,
    required this.projects,
    required this.activities,
  });
  final Entry? activeTimer;
  final List<Entry> entries;
  final List<NamedItem> customers;
  final List<Project> projects;
  final List<NamedItem> activities;

  factory Bootstrap.fromJson(Map<String, dynamic> json) => Bootstrap(
    activeTimer: json['activeTimer'] == null
        ? null
        : Entry.fromJson(json['activeTimer']),
    entries: (json['entries'] as List? ?? [])
        .map((item) => Entry.fromJson(item))
        .toList(),
    customers: (json['customers'] as List? ?? [])
        .map((item) => NamedItem.fromJson(item))
        .toList(),
    projects: (json['projects'] as List? ?? [])
        .map((item) => Project.fromJson(item))
        .toList(),
    activities: (json['activities'] as List? ?? [])
        .map((item) => NamedItem.fromJson(item))
        .toList(),
  );
}

class NamedItem {
  NamedItem({required this.id, required this.name});
  final String id;
  final String name;
  factory NamedItem.fromJson(Map<String, dynamic> json) =>
      NamedItem(id: json['id'] as String, name: json['name'] as String);
}

class Project extends NamedItem {
  Project({required super.id, required super.name, required this.customerId});
  final String customerId;
  factory Project.fromJson(Map<String, dynamic> json) => Project(
    id: json['id'] as String,
    name: json['name'] as String,
    customerId: json['customer_id'] as String,
  );
}

class Entry {
  Entry({
    required this.id,
    required this.customerName,
    required this.projectName,
    required this.activityName,
    required this.description,
    required this.durationSeconds,
    required this.startTime,
  });
  final String id;
  final String customerName;
  final String projectName;
  final String activityName;
  final String description;
  final int durationSeconds;
  final int startTime;
  factory Entry.fromJson(Map<String, dynamic> json) => Entry(
    id: json['id'] as String,
    customerName: json['customer_name'] as String? ?? 'Client',
    projectName: json['project_name'] as String? ?? 'Project',
    activityName: json['activity_name'] as String? ?? 'Activity',
    description: json['description'] as String? ?? '',
    durationSeconds: (json['duration_seconds'] as num?)?.toInt() ?? 0,
    startTime: (json['start_time'] as num?)?.toInt() ?? 0,
  );
}

String formatDuration(int seconds) {
  final hours = seconds ~/ 3600;
  final minutes = (seconds % 3600) ~/ 60;
  final remainder = seconds % 60;
  return '${hours.toString().padLeft(2, '0')}:${minutes.toString().padLeft(2, '0')}:${remainder.toString().padLeft(2, '0')}';
}
