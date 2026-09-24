class Moderado < Formula
  desc "Free-first AI coding agent"
  homepage "https://github.com/marcuz-apl/moderado"
  version "0.3.4"
  if OS.mac?
    url "https://github.com/marcuz-apl/moderado/releases/download/v0.3.4/moderado-macos-arm64"
    sha256 "603bb08bc4d8943fa055df3c4b28d627019a2babec75bb8313581693493ada9a"
  else
    url "https://github.com/marcuz-apl/moderado/releases/download/v0.3.4/moderado-linux-x64"
    sha256 "18fe18b531e2d1dbdfd0714bd2cf2e7edf8bae97bb0af0082424491fffd2094e"
  end
  def install
    if OS.mac?
      bin.install "moderado-macos-arm64" => "moderado"
    else
      bin.install "moderado-linux-x64" => "moderado"
    end
  end
end
