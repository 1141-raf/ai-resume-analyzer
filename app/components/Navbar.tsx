import {Link, useNavigate} from "react-router";
import {usePuterStore} from "~/lib/puter";

const Navbar = () => {
    const { auth, isLoading, error, clearError } = usePuterStore();
    const navigate = useNavigate();

    const handleSignOut = async () => {
        clearError();
        await auth.signOut();

        const state = usePuterStore.getState();
        if (!state.error && !state.auth.isAuthenticated) {
            navigate('/auth');
        }
    };

    return (
        <nav className="navbar">
            <Link to="/">
                <p className="text-2xl font-bold text-gradient">RESUMIND</p>
            </Link>
            <div className="flex items-center gap-3">
                <Link to="/upload" className="primary-button w-fit">
                    Upload Resume
                </Link>
                {auth.isAuthenticated && (
                    <button
                        type="button"
                        onClick={handleSignOut}
                        disabled={isLoading}
                        className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:border-slate-400 hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60"
                    >
                        {isLoading ? 'Logging out...' : 'Log out'}
                    </button>
                )}
            </div>
            {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        </nav>
    )
}
export default Navbar
