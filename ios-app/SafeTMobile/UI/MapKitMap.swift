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
    }

    final class Coordinator: NSObject, MKMapViewDelegate {
        var parent: MapKitMap
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
