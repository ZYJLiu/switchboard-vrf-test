use anchor_lang::prelude::*;

pub mod actions;
pub use actions::*;

pub use anchor_lang::solana_program::clock;
pub use anchor_spl::{
    associated_token::{get_associated_token_address, AssociatedToken},
    token::{self, Mint, MintTo, Token, TokenAccount},
};
pub use switchboard_v2::{
    OracleQueueAccountData, PermissionAccountData, SbState, VrfAccountData, VrfRequestRandomness,
};

// use crate::cpi::*;

declare_id!("5sbGMk8e86ukQ6wiWYZkfgc4zSs8D8VuD3jn9KkW5fWC");

#[program]
pub mod vrf_client {
    use super::*;

    pub fn init_lootbox(mut ctx: Context<InitLootbox>) -> Result<()> {
        InitLootbox::actuate(&mut ctx)
    }

    #[access_control(ctx.accounts.validate(&ctx, &params))]
    pub fn init_client(ctx: Context<InitClient>, params: InitClientParams) -> Result<()> {
        InitClient::actuate(&ctx, &params)
    }

    #[access_control(ctx.accounts.validate(&ctx, &params))]
    pub fn request_randomness(
        ctx: Context<RequestRandomness>,
        params: RequestRandomnessParams,
    ) -> Result<()> {
        RequestRandomness::actuate(&ctx, &params)
    }

    #[access_control(ctx.accounts.validate(&ctx, &params))]
    pub fn consume_randomness(
        ctx: Context<ConsumeRandomness>,
        params: ConsumeRandomnessParams,
    ) -> Result<()> {
        ConsumeRandomness::actuate(&ctx, &params)
    }

    pub fn mint_rewards(mut ctx: Context<MintReward>) -> Result<()> {
        MintReward::actuate(&mut ctx)
    }
}

const STATE_SEED: &[u8] = b"CLIENTSEED";
const LOOTBOX_SEED: &[u8] = b"LOOTBOX";
const MINT_AUTH_SEED: &[u8] = b"MINT_AUTH";

#[repr(packed)]
#[account(zero_copy)]
#[derive(Default)]
pub struct VrfClientState {
    pub bump: u8,
    pub max_result: u64,
    pub result_buffer: [u8; 32],
    pub result: u128,
    pub timestamp: i64,
    pub vrf: Pubkey,
    pub mint: Pubkey,
    pub token_account: Pubkey,
}

#[account]
#[derive(Default, PartialEq)]
pub struct Lootbox {
    pub mint_one: Pubkey,
    pub mint_two: Pubkey,
    pub mint_three: Pubkey,
}

#[error_code]
#[derive(Eq, PartialEq)]
pub enum VrfClientErrorCode {
    #[msg("Switchboard VRF Account's authority should be set to the client's state pubkey")]
    InvalidVrfAuthorityError,
    #[msg("The max result must not exceed u64")]
    MaxResultExceedsMaximum,
    #[msg("Invalid VRF account provided.")]
    InvalidVrfAccount,
    #[msg("Not a valid Switchboard account")]
    InvalidSwitchboardAccount,
}

#[event]
pub struct VrfClientCreated {
    pub vrf_client: Pubkey,
    pub max_result: u64,
    pub timestamp: i64,
}

#[event]
pub struct RandomnessRequested {
    pub vrf_client: Pubkey,
    pub max_result: u64,
    pub timestamp: i64,
}

#[event]
pub struct VrfClientUpdated {
    pub vrf_client: Pubkey,
    pub max_result: u64,
    pub result_buffer: [u8; 32],
    pub result: u128,
    pub timestamp: i64,
}
