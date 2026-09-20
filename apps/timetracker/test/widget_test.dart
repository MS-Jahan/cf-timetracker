import 'package:flutter_test/flutter_test.dart';

import 'package:timetracker/main.dart';

void main() {
  testWidgets('renders the Timetracker shell', (tester) async {
    await tester.pumpWidget(const TimeTrackerApp());
    expect(find.text('Dashboard'), findsWidgets);
  });
}
