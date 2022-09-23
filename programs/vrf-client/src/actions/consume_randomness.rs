use std::f32::MIN;

use crate::*;

use anchor_spl::{
    associated_token::AssociatedToken,
    token::{Approve, Mint, MintTo, Revoke, Token, TokenAccount},
};

#[derive(Accounts)]
#[instruction(params: ConsumeRandomnessParams)] // rpc parameters hint
pub struct ConsumeRandomness<'info> {
    #[account(
        mut,
        seeds = [
            STATE_SEED,
            vrf.key().as_ref(),
        ],
        bump = state.load()?.bump,
        has_one = vrf @ VrfClientErrorCode::InvalidVrfAccount
    )]
    pub state: AccountLoader<'info, VrfClientState>,
    pub vrf: AccountLoader<'info, VrfAccountData>,
    pub lootbox: Account<'info, Lootbox>,
    pub payer: Signer<'info>,
}

#[derive(Clone, AnchorSerialize, AnchorDeserialize)]
pub struct ConsumeRandomnessParams {}

impl ConsumeRandomness<'_> {
    pub fn validate(&self, _ctx: &Context<Self>, _params: &ConsumeRandomnessParams) -> Result<()> {
        Ok(())
    }

    pub fn actuate(ctx: &Context<Self>, _params: &ConsumeRandomnessParams) -> Result<()> {
        let vrf = ctx.accounts.vrf.load()?;
        let result_buffer = vrf.get_result()?;
        if result_buffer == [0u8; 32] {
            msg!("vrf buffer empty");
            return Ok(());
        }

        let state = &mut ctx.accounts.state.load_mut()?;
        let max_result = state.max_result;
        if result_buffer == state.result_buffer {
            msg!("result_buffer unchanged");
            return Ok(());
        }

        msg!("Result buffer is {:?}", result_buffer);
        let value: &[u128] = bytemuck::cast_slice(&result_buffer[..]);
        msg!("u128 buffer {:?}", value);
        let result = value[0] % max_result as u128 + 1;
        msg!("Current VRF Value [1 - {}) = {}!", max_result, result);

        if state.result != result {
            state.result_buffer = result_buffer;
            state.result = result;
            state.timestamp = clock::Clock::get().unwrap().unix_timestamp;

            emit!(VrfClientUpdated {
                vrf_client: ctx.accounts.state.key(),
                max_result: state.max_result,
                result: state.result,
                result_buffer: result_buffer,
                timestamp: state.timestamp,
            });
        }

        if result == 1 {
            msg!("Mint One: {:?}", ctx.accounts.lootbox.mint_one);
            let token_address = get_associated_token_address(
                &ctx.accounts.payer.key(),
                &ctx.accounts.lootbox.mint_one,
            );
            state.token_account = token_address;
            state.mint = ctx.accounts.lootbox.mint_one;

            // let accounts = MintReward {
            //     mint: ctx.accounts.lootbox.mint_one.to_account_info(),
            //     token_account:,
            //     user:
            // };
            // let ctx = Context::new(ctx.program_id, &mut accounts, remaining_accounts);
            // cpi::mint_rewards(ctx)
        }

        if result == 2 {
            msg!("Mint Two: {:?}", ctx.accounts.lootbox.mint_two);
            let token_address = get_associated_token_address(
                &ctx.accounts.payer.key(),
                &ctx.accounts.lootbox.mint_two,
            );
            state.token_account = token_address;
            state.mint = ctx.accounts.lootbox.mint_two
        }

        if result == 3 {
            msg!("Mint Three: {:?}", ctx.accounts.lootbox.mint_three);
            let token_address = get_associated_token_address(
                &ctx.accounts.payer.key(),
                &ctx.accounts.lootbox.mint_three,
            );
            state.token_account = token_address;
            state.mint = ctx.accounts.lootbox.mint_three
        }
        Ok(())
    }
}
