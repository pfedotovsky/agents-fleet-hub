# Homebrew formula for fleet-server — copy into pfedotovsky/homebrew-tap
# (Formula/fleet-server.rb) and bump version + sha256 values on each release
# (shas are printed by the release workflow / found in the *.sha256 assets).
class FleetServer < Formula
  desc "Single-binary agent host server for Agents Hub (fork of CloudCLI UI server)"
  homepage "https://github.com/pfedotovsky/agents-fleet-hub"
  version "0.1.0"
  license "AGPL-3.0-or-later"

  on_macos do
    on_arm do
      url "https://github.com/pfedotovsky/agents-fleet-hub/releases/download/server-v#{version}/fleet-server-#{version}-darwin-arm64.tar.gz"
      sha256 "REPLACE_WITH_DARWIN_ARM64_SHA256"
    end
  end

  on_linux do
    on_intel do
      url "https://github.com/pfedotovsky/agents-fleet-hub/releases/download/server-v#{version}/fleet-server-#{version}-linux-x64.tar.gz"
      sha256 "REPLACE_WITH_LINUX_X64_SHA256"
    end
    on_arm do
      url "https://github.com/pfedotovsky/agents-fleet-hub/releases/download/server-v#{version}/fleet-server-#{version}-linux-arm64.tar.gz"
      sha256 "REPLACE_WITH_LINUX_ARM64_SHA256"
    end
  end

  recommends "ripgrep" # enables session search

  def install
    bin.install "fleet-server"
    doc.install "LICENSE", "NOTICE", "THIRD-PARTY-NOTICES.md"
  end

  service do
    run [opt_bin/"fleet-server"]
    keep_alive true
    environment_variables SERVER_PORT: "3011"
    log_path var/"log/fleet-server.log"
    error_log_path var/"log/fleet-server.log"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/fleet-server version")
  end
end
