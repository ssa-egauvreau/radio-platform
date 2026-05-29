import SwiftUI
import UIKit

/// Always-thumbable 140 pt PTT control. Drag/release semantics match the legacy
/// pttBar so the view-model contract is unchanged.
struct BigPttButton: View {
    let isPressed: Bool
    let onPress: () -> Void
    let onRelease: () -> Void

    @State private var localPressed = false
    @State private var animating = false

    private let heavyHaptic = UIImpactFeedbackGenerator(style: .heavy)
    private let mediumHaptic = UIImpactFeedbackGenerator(style: .medium)

    var body: some View {
        ZStack {
            if isPressed {
                Circle()
                    .stroke(Color.safetGreen, lineWidth: 4)
                    .frame(width: 140, height: 140)
                    .scaleEffect(animating ? 1.12 : 1.0)
                    .animation(.easeInOut(duration: 0.6).repeatForever(autoreverses: true), value: animating)
                    .onAppear { animating = true }
                    .onDisappear { animating = false }
            }
            Circle()
                .fill(isPressed ? Color.safetGreen : Color.safetBlue)
                .frame(width: 140, height: 140)
                .overlay(
                    VStack(spacing: 4) {
                        Image(systemName: "dot.radiowaves.left.and.right")
                            .font(.system(size: 32, weight: .heavy))
                        Text("PTT")
                            .font(.system(size: 18, weight: .heavy))
                    }
                    .foregroundColor(.white)
                )
        }
        .contentShape(Circle())
        .gesture(
            DragGesture(minimumDistance: 0)
                .onChanged { _ in
                    if !localPressed {
                        localPressed = true
                        heavyHaptic.impactOccurred()
                        onPress()
                    }
                }
                .onEnded { _ in
                    localPressed = false
                    mediumHaptic.impactOccurred()
                    onRelease()
                }
        )
        .onAppear {
            heavyHaptic.prepare()
            mediumHaptic.prepare()
        }
        .accessibilityElement()
        .accessibilityLabel("Push to talk")
        .accessibilityHint("Hold to transmit")
        .accessibilityAddTraits(isPressed ? [.isSelected] : [])
    }
}
