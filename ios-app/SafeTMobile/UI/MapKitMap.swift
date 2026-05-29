import MapKit
import SwiftUI
import UIKit

/// UIViewRepresentable wrapping MKMapView so we get marker clustering and the
/// follow-me user-tracking mode — both absent from the iOS-16 SwiftUI Map.
struct MapKitMap: UIViewRepresentable {
    @Binding var region: MKCoordinateRegion
    var positions: [UnitPosition]
    @Binding var followMe: Bool
    @Binding var selectedUnit: String?

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> MKMapView {
        let map = MKMapView()
        map.showsUserLocation = true
        map.delegate = context.coordinator
        map.region = region
        map.register(MKMarkerAnnotationView.self, forAnnotationViewWithReuseIdentifier: MKMapViewDefaultAnnotationViewReuseIdentifier)
        return map
    }

    func updateUIView(_ map: MKMapView, context: Context) {
        context.coordinator.parent = self
        let existing = map.annotations.compactMap { $0 as? UnitAnnotation }
        let existingIds = Set(existing.map { $0.unitId })
        let desiredIds = Set(positions.map { $0.unitId })

        let stale = existing.filter { !desiredIds.contains($0.unitId) }
        if !stale.isEmpty { map.removeAnnotations(stale) }

        for position in positions {
            if let prior = existing.first(where: { $0.unitId == position.unitId }) {
                let coord = CLLocationCoordinate2D(latitude: position.lat, longitude: position.lon)
                if prior.coordinate.latitude != coord.latitude || prior.coordinate.longitude != coord.longitude {
                    prior.coordinate = coord
                }
                prior.title = position.unitId
                prior.subtitle = position.displayName
            } else if !existingIds.contains(position.unitId) {
                let annotation = UnitAnnotation(
                    unitId: position.unitId,
                    coordinate: CLLocationCoordinate2D(latitude: position.lat, longitude: position.lon),
                    title: position.unitId,
                    subtitle: position.displayName
                )
                map.addAnnotation(annotation)
            }
        }

        let desiredMode: MKUserTrackingMode = followMe ? .follow : .none
        if map.userTrackingMode != desiredMode {
            map.setUserTrackingMode(desiredMode, animated: true)
        }

        // Push binding region back into the map view when SwiftUI has changed
        // it (e.g. the fit-to-positions toolbar button). Without this guard
        // the binding is write-only — pan/zoom propagates up via the
        // delegate, but external mutations were dropped because the original
        // code only set `map.region` in `makeUIView`.
        if !Self.regionsApproximatelyEqual(map.region, region) {
            context.coordinator.isProgrammaticRegionChange = true
            map.setRegion(region, animated: true)
            // The guard is reset in `regionDidChangeAnimated` once the
            // delegate fires — clearing it here would race with the
            // animation and re-enable the propagation path before
            // MKMapView has finished snapping to the new region.
        }
    }

    /// Component-wise comparison so floating-point noise from MKMapView's
    /// internal region snapping doesn't cause endless update loops.
    fileprivate static func regionsApproximatelyEqual(
        _ a: MKCoordinateRegion,
        _ b: MKCoordinateRegion,
        epsilon: CLLocationDegrees = 0.0001
    ) -> Bool {
        abs(a.center.latitude - b.center.latitude) < epsilon &&
        abs(a.center.longitude - b.center.longitude) < epsilon &&
        abs(a.span.latitudeDelta - b.span.latitudeDelta) < epsilon &&
        abs(a.span.longitudeDelta - b.span.longitudeDelta) < epsilon
    }

    final class Coordinator: NSObject, MKMapViewDelegate {
        var parent: MapKitMap
        /// Suppresses the delegate's region-did-change → binding write loop
        /// when `updateUIView` is the one driving the region change.
        var isProgrammaticRegionChange = false
        init(_ parent: MapKitMap) { self.parent = parent }

        func mapView(_ mapView: MKMapView, viewFor annotation: MKAnnotation) -> MKAnnotationView? {
            if annotation is MKUserLocation { return nil }
            if let cluster = annotation as? MKClusterAnnotation {
                let view = MKMarkerAnnotationView(annotation: cluster, reuseIdentifier: nil)
                view.markerTintColor = .systemBlue
                return view
            }
            let view = mapView.dequeueReusableAnnotationView(
                withIdentifier: MKMapViewDefaultAnnotationViewReuseIdentifier,
                for: annotation
            ) as? MKMarkerAnnotationView ?? MKMarkerAnnotationView(annotation: annotation, reuseIdentifier: MKMapViewDefaultAnnotationViewReuseIdentifier)
            view.clusteringIdentifier = "unit"
            view.markerTintColor = .systemBlue
            view.canShowCallout = true
            if let unit = annotation as? UnitAnnotation {
                view.accessibilityLabel = "Unit \(unit.unitId)"
            }
            return view
        }

        func mapView(_ mapView: MKMapView, didSelect view: MKAnnotationView) {
            if let unit = view.annotation as? UnitAnnotation {
                parent.selectedUnit = unit.unitId
            }
        }

        func mapView(_ mapView: MKMapView, didChange mode: MKUserTrackingMode, animated: Bool) {
            let following = (mode != .none)
            if parent.followMe != following { parent.followMe = following }
        }

        func mapView(_ mapView: MKMapView, regionDidChangeAnimated animated: Bool) {
            // Clear the programmatic guard on the trailing edge of any
            // setRegion-driven animation, then propagate user-driven
            // pan/zoom changes back to the binding so the SwiftUI side can
            // observe the current viewport.
            if isProgrammaticRegionChange {
                isProgrammaticRegionChange = false
                return
            }
            let newRegion = mapView.region
            if !MapKitMap.regionsApproximatelyEqual(parent.region, newRegion) {
                parent.region = newRegion
            }
        }
    }
}

final class UnitAnnotation: NSObject, MKAnnotation {
    let unitId: String
    dynamic var coordinate: CLLocationCoordinate2D
    var title: String?
    var subtitle: String?

    init(unitId: String, coordinate: CLLocationCoordinate2D, title: String?, subtitle: String?) {
        self.unitId = unitId
        self.coordinate = coordinate
        self.title = title
        self.subtitle = subtitle
    }
}
