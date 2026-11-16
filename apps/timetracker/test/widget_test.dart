import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:timetracker/main.dart';
import 'package:timetracker/token_store.dart';

void main() {
  testWidgets('shows the sign-in screen without a stored token', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues({});
    await tester.pumpWidget(TimeTrackerApp(tokenStore: MemoryTokenStore()));
    await tester.pumpAndSettle();
    expect(find.text('Sign in'), findsWidgets);
  });
}
