// Stub gRPC client for Stage4 fallback
// This prevents module not found errors and allows Stage4 to start

class Stage4GrpcClient {
  isClientConnected() {
    return false;
  }

  async getGameDataWithFallback(stage) {
    return {
      success: true,
      data: {
        gameId: `FALLBACK-${stage.toUpperCase()}`,
        payout: 0,
        selectedBoard: 'fallback_player:1',
        totalPlayers: 1,
        stage: stage.toUpperCase()
      },
      source: 'grpc_stub',
      message: 'gRPC client not implemented - returning safe fallback data'
    };
  }

  async getGameData(stage) {
    return {
      success: true,
      data: {
        gameId: `FALLBACK-${stage.toUpperCase()}`,
        payout: 0,
        selectedBoard: 'fallback_player:1',
        totalPlayers: 1,
        stage: stage.toUpperCase()
      },
      source: 'grpc_stub',
      message: 'gRPC client not implemented - returning safe fallback data'
    };
  }

  async placeBet(playerId, stage, amount, boardSelection) {
    return { success: false, betId: null, playerId, amount, status: 'unavailable', source: 'grpc_stub', message: 'gRPC client not implemented' };
  }

  async getStatus(detailed) {
    return { success: false, status: null, source: 'grpc_stub', message: 'gRPC client not implemented' };
  }  // ← Fixed: Added missing closing brace for getStatus method
}  // ← Fixed: Closing brace for the class

module.exports = Stage4GrpcClient;
// Removed: this.grpcClient.on('connected', () => { ... }) - This doesn't belong here