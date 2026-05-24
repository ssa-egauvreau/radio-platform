import XCTest
@testable import SafeTMobile

final class AuthApiClientTests: XCTestCase {
    private let baseURL = URL(string: "https://radio.example.com")!

    override func setUp() {
        super.setUp()
        StubURLProtocol.reset()
    }

    override func tearDown() {
        StubURLProtocol.reset()
        super.tearDown()
    }

    private func makeClient() -> AuthApiClient {
        AuthApiClient(baseURL: baseURL, session: StubURLProtocol.makeSession())
    }

    func test_login_postsCredentials_andDecodesTokenAndUser() async throws {
        StubURLProtocol.handler = { _ in
            let json = """
            {
              "token": "jwt-token-here",
              "user": {
                "id": 7,
                "username": "alice",
                "displayName": "Alice Officer",
                "role": "radio",
                "unitId": "A7",
                "agencyId": 1,
                "agencyName": "Sunset Safety"
              }
            }
            """
            return .init(body: Data(json.utf8))
        }

        let response = try await makeClient().login(username: "alice", password: "secret")

        XCTAssertEqual(response.token, "jwt-token-here")
        XCTAssertEqual(response.user.id, 7)
        XCTAssertEqual(response.user.username, "alice")
        XCTAssertEqual(response.user.displayName, "Alice Officer")
        XCTAssertEqual(response.user.role, "radio")
        XCTAssertEqual(response.user.unitId, "A7")
        XCTAssertEqual(response.user.agencyName, "Sunset Safety")

        let request = try XCTUnwrap(StubURLProtocol.observedRequests.first)
        XCTAssertEqual(request.url?.path, "/v1/auth/login")
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")

        let body = try JSONSerialization.jsonObject(with: try XCTUnwrap(request.httpBody)) as? [String: String]
        XCTAssertEqual(body?["username"], "alice")
        XCTAssertEqual(body?["password"], "secret")
    }

    func test_login_trimsUsername() async throws {
        StubURLProtocol.handler = { _ in
            return .init(body: Data(#"{"token":"t","user":{"id":1,"username":"u","displayName":"U","role":"radio","unitId":null,"agencyId":1,"agencyName":"X"}}"#.utf8))
        }

        _ = try await makeClient().login(username: "  alice  ", password: "x")

        let request = try XCTUnwrap(StubURLProtocol.observedRequests.first)
        let body = try JSONSerialization.jsonObject(with: try XCTUnwrap(request.httpBody)) as? [String: String]
        XCTAssertEqual(body?["username"], "alice")
    }

    func test_login_throwsMissingCredentials_whenEmpty() async {
        do {
            _ = try await makeClient().login(username: "", password: "")
            XCTFail("expected missingCredentials")
        } catch AuthError.missingCredentials {
            // expected
        } catch {
            XCTFail("unexpected error: \(error)")
        }
    }

    func test_login_throwsInvalidLogin_on401() async {
        StubURLProtocol.handler = { _ in .init(statusCode: 401, body: Data(#"{"error":"invalid_login"}"#.utf8)) }

        do {
            _ = try await makeClient().login(username: "alice", password: "wrong")
            XCTFail("expected invalidLogin")
        } catch AuthError.invalidLogin {
            // expected
        } catch {
            XCTFail("unexpected error: \(error)")
        }
    }

    func test_login_throwsServer_on5xx() async {
        StubURLProtocol.handler = { _ in .init(statusCode: 502) }

        do {
            _ = try await makeClient().login(username: "alice", password: "x")
            XCTFail("expected server error")
        } catch let AuthError.server(code) {
            XCTAssertEqual(code, 502)
        } catch {
            XCTFail("unexpected error: \(error)")
        }
    }

    // MARK: - AuthenticatedUser.radioUnitId

    func test_radioUnitId_usesUnitId_whenSet() {
        let user = AuthenticatedUser(id: 1, username: "alice", displayName: "A", role: "radio", unitId: " a7 ", agencyId: 1, agencyName: nil)
        XCTAssertEqual(user.radioUnitId, "A7")
    }

    func test_radioUnitId_fallsBackToUsername_whenUnitIdMissing() {
        let user = AuthenticatedUser(id: 1, username: "alice", displayName: "A", role: "radio", unitId: nil, agencyId: 1, agencyName: nil)
        XCTAssertEqual(user.radioUnitId, "ALICE")
    }

    func test_radioUnitId_fallsBackToUsername_whenUnitIdBlank() {
        let user = AuthenticatedUser(id: 1, username: "alice", displayName: "A", role: "radio", unitId: "   ", agencyId: 1, agencyName: nil)
        XCTAssertEqual(user.radioUnitId, "ALICE")
    }
}
