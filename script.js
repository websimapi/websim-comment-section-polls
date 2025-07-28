const { useState, useEffect, useMemo, useSyncExternalStore } = React;

const room = new WebsimSocket();

// --- Components ---

function PollCreator({ creatorUsername }) {
    const [question, setQuestion] = useState('');
    const [options, setOptions] = useState(['', '']);
    const [durationDays, setDurationDays] = useState(7);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleAddOption = () => {
        if (options.length < 6) {
            setOptions([...options, '']);
        }
    };

    const handleOptionChange = (index, value) => {
        const newOptions = [...options];
        newOptions[index] = value;
        setOptions(newOptions);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (isSubmitting || !question.trim() || options.some(opt => !opt.trim())) return;

        setIsSubmitting(true);
        const endDate = new Date();
        endDate.setDate(endDate.getDate() + parseInt(durationDays, 10));

        try {
            const trimmedOptions = options.map(o => o.trim()).filter(o => o);
            const newPoll = await room.collection('polls_v1').create({
                question: question.trim(),
                options: trimmedOptions,
                endDate: endDate.toISOString(),
                creatorUsername,
            });

            // Suggest a comment announcing the new poll
            const pollQuestionText = question.trim();
            const formattedOptions = trimmedOptions
                .map((option, index) => `${String.fromCharCode(65 + index)}. ${option}`)
                .join('\n');
            
            const commentContent = `📊 **New Poll: ${pollQuestionText}**\n\n${formattedOptions}\n\nThis poll is now active! You can vote by clicking an option on the page, or by posting a comment with \`${newPoll.id}:CHOICE\` (e.g., \`${newPoll.id}:A\`).`;

            await window.websim.postComment({ content: commentContent });

            setQuestion('');
            setOptions(['', '']);
            setDurationDays(7);
        } catch (error) {
            console.error("Failed to create poll:", error);
            alert("Error creating poll. Please try again.");
        } finally {
            setIsSubmitting(false);
        }
    };

    const canSubmit = question.trim() && options.every(opt => opt.trim()) && !isSubmitting;

    return (
        <div className="poll-creator">
            <h2>Create a New Poll</h2>
            <form onSubmit={handleSubmit}>
                <input
                    type="text"
                    placeholder="Poll Question"
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    required
                />
                <div className="options-container">
                    {options.map((option, index) => (
                        <div key={index} className="option-input">
                            <label>{String.fromCharCode(65 + index)}:</label>
                            <input
                                type="text"
                                placeholder={`Option ${index + 1}`}
                                value={option}
                                onChange={(e) => handleOptionChange(index, e.target.value)}
                                required
                            />
                        </div>
                    ))}
                </div>
                 {options.length < 6 && <button type="button" onClick={handleAddOption} style={{backgroundColor: '#31a24c', marginRight: '10px'}}>Add Option</button>}

                <label>
                    Poll Duration (days):
                    <input
                        type="number"
                        value={durationDays}
                        onChange={(e) => setDurationDays(e.target.value)}
                        min="1"
                        max="30"
                        required
                    />
                </label>
                <button type="submit" disabled={!canSubmit}>
                    {isSubmitting ? 'Creating...' : 'Create Poll'}
                </button>
            </form>
        </div>
    );
}


function Poll({ poll, comments }) {
    const { id, question, options, endDate, created_at } = poll;
    const isPollActive = new Date() < new Date(endDate);
    const optionChars = options.map((_, i) => String.fromCharCode(65 + i));

    const votes = useMemo(() => {
        const pollVotes = {}; // { username: { choice: 'A', date: '...' } }
        const regex = new RegExp(`^${id}:([A-F])$`, 'i');
        const pollStartDate = new Date(created_at);
        const pollEndDate = new Date(endDate);
        
        const sortedComments = [...comments].sort((a,b) => new Date(a.created_at) - new Date(b.created_at));

        for (const comment of sortedComments) {
            const commentDate = new Date(comment.created_at);
            if (commentDate < pollStartDate || commentDate > pollEndDate) {
                continue;
            }

            const match = comment.raw_content.trim().match(regex);
            if (match) {
                const choice = match[1].toUpperCase();
                if (optionChars.includes(choice)) {
                     pollVotes[comment.author.username] = { choice, date: comment.created_at };
                }
            }
        }
        
        const voteCounts = options.reduce((acc, _, i) => {
            acc[optionChars[i]] = 0;
            return acc;
        }, {});

        Object.values(pollVotes).forEach(({ choice }) => {
            if (voteCounts.hasOwnProperty(choice)) {
                voteCounts[choice]++;
            }
        });
        
        return voteCounts;

    }, [comments, id, options, endDate, created_at]);
    
    const totalVotes = Object.values(votes).reduce((sum, count) => sum + count, 0);

    const handleVote = async (choice) => {
        if (!isPollActive) return;
        const voteString = `${id}:${choice}`;
        try {
            const result = await window.websim.postComment({ content: voteString });
            if (result && result.error) {
                 // Log error but don't alert, as user might have just cancelled.
                console.warn('Could not post comment:', result.error);
            }
        } catch (error) {
            console.error("Failed to initiate vote comment:", error);
        }
    };

    return (
        <div className="poll-container">
            <div className="poll">
                <div className="poll-info">
                    <span className={`poll-status ${isPollActive ? 'active' : 'closed'}`}>
                        {isPollActive ? '● Active' : '■ Closed'}
                    </span>
                    <span>Ends: {new Date(endDate).toLocaleString()}</span>
                </div>
                <p className="poll-question">{question}</p>
                <div className="poll-options">
                    {options.map((option, index) => {
                        const choiceChar = optionChars[index];
                        const voteCount = votes[choiceChar] || 0;
                        const percentage = totalVotes > 0 ? (voteCount / totalVotes) * 100 : 0;
                        const canVote = isPollActive;

                        return (
                            <div 
                                key={index} 
                                className={`poll-option ${canVote ? 'votable' : ''}`}
                                onClick={canVote ? () => handleVote(choiceChar) : undefined}
                                role={canVote ? "button" : "status"}
                                tabIndex={canVote ? "0" : "-1"}
                                onKeyDown={canVote ? (e) => (e.key === 'Enter' || e.key === ' ') && handleVote(choiceChar) : undefined}
                            >
                                <div className="option-label">
                                    <span className="option-text">{choiceChar}. {option}</span>
                                    <span className="vote-percent">{voteCount} vote{voteCount !== 1 ? 's' : ''}</span>
                                </div>
                                <div className="progress-bar-container">
                                    <div className="progress-bar" style={{ width: `${percentage}%` }}>
                                       {percentage > 15 ? `${percentage.toFixed(0)}%` : ''}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
                {isPollActive && (
                     <div className="vote-instructions">
                        To vote, click an option above or post a comment with <code>{id}:CHOICE</code> (e.g., <code>{id}:A</code>)
                    </div>
                )}
            </div>
        </div>
    );
}

function App() {
    const [currentUser, setCurrentUser] = useState(null);
    const [creator, setCreator] = useState(null);
    const [project, setProject] = useState(null);

    const polls = useSyncExternalStore(
        room.collection('polls_v1').subscribe,
        room.collection('polls_v1').getList
    ) || [];
    
    const [comments, setComments] = useState([]);
    const [loadingComments, setLoadingComments] = useState(true);

    useEffect(() => {
        Promise.all([
            window.websim.getCurrentUser(),
            window.websim.getCreator(),
            window.websim.getCurrentProject()
        ]).then(([user, projCreator, proj]) => {
            setCurrentUser(user);
            setCreator(projCreator);
            setProject(proj);
        });
    }, []);
    
    useEffect(() => {
        if (!project) return;

        const fetchComments = async () => {
            setLoadingComments(true);
            try {
                // The API returns comments in pages. We may need to fetch multiple pages for all votes.
                // For simplicity here, we'll fetch the first (and most recent) 100.
                const response = await fetch(`/api/v1/projects/${project.id}/comments?first=100`);
                if (!response.ok) throw new Error('Failed to fetch comments');
                const data = await response.json();
                setComments(data.comments.data.map(c => c.comment));
            } catch (error) {
                console.error(error);
            } finally {
                setLoadingComments(false);
            }
        };

        fetchComments();

        const handleNewComment = (event) => {
            const newComment = event.comment;
            if (newComment.project_id === project.id) {
                setComments(prev => [newComment, ...prev]);
            }
        };

        window.websim.addEventListener('comment:created', handleNewComment);
        return () => window.websim.removeEventListener('comment:created', handleNewComment);
    }, [project]);


    const isCreator = currentUser && creator && currentUser.id === creator.id;
    const sortedPolls = [...polls].sort((a,b) => new Date(b.created_at) - new Date(a.created_at));

    return (
        <div>
            <h1>📊 Comment Polls</h1>
            {isCreator && <PollCreator creatorUsername={creator.username} />}
            
            <h2>Active & Past Polls</h2>
            {loadingComments && <p>Loading comments for voting...</p>}
            {sortedPolls.length > 0 ? (
                sortedPolls.map(poll => (
                    <Poll key={poll.id} poll={poll} comments={comments} />
                ))
            ) : (
                <p className="no-polls">No polls have been created yet. The project owner can create one.</p>
            )}
        </div>
    );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);