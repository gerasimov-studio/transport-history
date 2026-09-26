package auth

import "testing"

func TestVerifyPasswordAcceptsNodeScryptHash(t *testing.T) {
	// Fixture produced by node:crypto.scryptSync with the parameters used by
	// the legacy API. It protects compatibility while authentication moves to Go.
	const stored = "00112233445566778899aabbccddeeff:fcd5a58d5301bbc44e90fc9a53f156134baee795eb7735ed6473da86e34ba93009476236665814fe08f7bd38ad1f5a2709832fb447b93b94e1a4a94dc5d1442e"
	if !VerifyPassword("correct horse battery staple", stored) {
		t.Fatal("valid legacy password was rejected")
	}
	if VerifyPassword("wrong password", stored) {
		t.Fatal("invalid password was accepted")
	}
}

func TestHashPasswordRoundTrip(t *testing.T) {
	stored, err := HashPassword("long-enough-password")
	if err != nil {
		t.Fatal(err)
	}
	if !VerifyPassword("long-enough-password", stored) {
		t.Fatal("new password hash could not be verified")
	}
}

func TestVerifyPasswordRejectsMalformedHashes(t *testing.T) {
	for _, stored := range []string{"", "missing-separator", "zz:00", "00:zz"} {
		if VerifyPassword("password", stored) {
			t.Fatalf("malformed hash %q was accepted", stored)
		}
	}
}
