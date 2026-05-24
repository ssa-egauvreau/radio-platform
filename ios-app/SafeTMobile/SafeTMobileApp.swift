import SwiftUI

@main
struct SafeTMobileApp: App {
    @StateObject private var session: AuthSession = {
        #if DEBUG
        if CommandLine.arguments.contains("-uitest-logged-in") {
            return AuthSession.forUITesting()
        }
        #endif
        return AuthSession()
    }()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(session)
                .preferredColorScheme(.dark)
        }
    }
}

/// Switches between the login screen and the radio shell as the session's
/// current user changes.
private struct RootView: View {
    @EnvironmentObject private var session: AuthSession

    var body: some View {
        if let user = session.currentUser, let token = session.token {
            RadioScreen(viewModel: RadioViewModel(user: user, token: token))
                .id(user.id)
        } else {
            LoginScreen()
        }
    }
}
