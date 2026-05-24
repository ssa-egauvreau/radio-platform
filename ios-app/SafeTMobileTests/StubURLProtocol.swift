import Foundation

/// URLProtocol stub used to intercept HTTP traffic in RadioApiClient tests.
/// Install it on a URLSessionConfiguration and route requests through a handler.
final class StubURLProtocol: URLProtocol {
    struct Stubbed {
        var statusCode: Int = 200
        var headers: [String: String] = ["Content-Type": "application/json"]
        var body: Data = Data()
    }

    /// All requests the stub has observed since the last `reset()`, in order.
    static var observedRequests: [URLRequest] = []
    /// Returns the response for a given request. Set this in each test.
    static var handler: ((URLRequest) -> Stubbed)?

    static func reset() {
        observedRequests = []
        handler = nil
    }

    static func makeSession() -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubURLProtocol.self]
        return URLSession(configuration: config)
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        Self.observedRequests.append(Self.materialize(request))
        let stub = Self.handler?(request) ?? Stubbed()
        let response = HTTPURLResponse(
            url: request.url!,
            statusCode: stub.statusCode,
            httpVersion: "HTTP/1.1",
            headerFields: stub.headers
        )!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: stub.body)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}

    /// URLProtocol exposes POST bodies via `httpBodyStream`, not `httpBody`.
    /// Drain the stream into a regular Data so assertions are easy to write.
    private static func materialize(_ request: URLRequest) -> URLRequest {
        var copy = request
        if copy.httpBody == nil, let stream = copy.httpBodyStream {
            stream.open()
            defer { stream.close() }
            var data = Data()
            let bufferSize = 4096
            let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: bufferSize)
            defer { buffer.deallocate() }
            while stream.hasBytesAvailable {
                let read = stream.read(buffer, maxLength: bufferSize)
                if read <= 0 { break }
                data.append(buffer, count: read)
            }
            copy.httpBody = data
        }
        return copy
    }
}
